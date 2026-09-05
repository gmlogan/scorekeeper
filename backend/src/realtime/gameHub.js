const { ScoreError } = require('../services/scoreService');
const { hashToken } = require('../lib/token');

// Last N score entries kept per player, in memory and on the wire.
const HISTORY_LIMIT = 5;
// Leading-edge debounce window for score patches (ms).
const PATCH_DEBOUNCE_MS = Number(process.env.BROADCAST_DEBOUNCE_MS) || 200;
// App-level WebSocket heartbeat. Raw `ws` ping/pong, far coarser than
// Socket.io's 25s default — idle tabs cost almost nothing.
const HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS) || 90000;

// ---------------------------------------------------------------------------
// GameHub
//
// One in-memory room per active game holds the authoritative state: status,
// roster, per-player score + recent history, and the set of open sockets.
// - Reads/broadcasts are served from memory — zero DB queries per frame.
// - Writes are persisted through the existing (serialized) SQLite layer,
//   then memory is updated from the authoritative DB result.
// - The common case (a score change) broadcasts a small `game:patch`;
//   full `game:state` frames are reserved for join / resync / roster or
//   status changes.
//
// This is deliberately transport-minimal (raw `ws`, JSON messages) so it
// ports cleanly to a Cloudflare Durable Object later: `room` -> the DO
// instance, `room.sockets` -> `ctx.getWebSockets()`, `handleMessage` ->
// `webSocketMessage`.
// ---------------------------------------------------------------------------
class GameHub {
  constructor(db) {
    this.db = db;
    this.rooms = new Map(); // gameId -> room
  }

  attach(wss) {
    this.wss = wss;
    wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    this.heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch (_) {
          /* socket already gone */
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();

    wss.on('close', () => clearInterval(this.heartbeat));
  }

  // ---- room lifecycle ---------------------------------------------------

  async loadRoom(gameId) {
    let room = this.rooms.get(gameId);
    if (room && room.loaded) return room;

    if (!room) {
      room = {
        gameId,
        loaded: false,
        version: 0,
        game: null,
        players: new Map(), // playerId -> { player_id, display_name, current_score }
        history: new Map(), // playerId -> [entry]
        sockets: new Set(),
        pending: [], // score changes accumulated since the last flush
        timer: null,
      };
      this.rooms.set(gameId, room);
    }

    const game = await this.db.getGameById(gameId);
    if (!game) {
      this.rooms.delete(gameId);
      return null;
    }

    await this.hydrate(room, game);
    room.loaded = true;
    return room;
  }

  async hydrate(room, game) {
    room.game = {
      id: game.id,
      code: game.code,
      name: game.name,
      host_id: game.host_id,
      status: game.status,
      target_score: game.target_score,
      time_limit: game.time_limit,
    };

    const players = await this.db.getGamePlayers(game.id);
    const nextPlayers = new Map();
    const nextHistory = new Map();

    await Promise.all(
      players.map(async (p) => {
        nextPlayers.set(p.player_id, {
          player_id: p.player_id,
          display_name: p.display_name,
          current_score: p.current_score,
        });
        const rows = await this.db.getScoreHistory(game.id, p.player_id, HISTORY_LIMIT);
        nextHistory.set(
          p.player_id,
          rows.map((r) => ({
            id: r.id,
            change_amount: r.change_amount,
            new_score: r.new_score,
            timestamp: r.timestamp,
          }))
        );
      })
    );

    room.players = nextPlayers;
    room.history = nextHistory;
  }

  dropRoomIfEmpty(room) {
    if (room.sockets.size > 0) return;
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    this.rooms.delete(room.gameId);
  }

  // ---- frames & broadcasting -----------------------------------------

  // Pure — no version side effect. Used for resync replies.
  frame(room) {
    return {
      type: 'game:state',
      version: room.version,
      game: room.game,
      players: [...room.players.values()],
      history: Object.fromEntries(room.history),
    };
  }

  send(ws, payload) {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch (_) {
      /* ignore */
    }
  }

  broadcast(room, payload) {
    const data = JSON.stringify(payload);
    for (const ws of room.sockets) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        ws.send(data);
      } catch (_) {
        /* ignore */
      }
    }
  }

  // Authoritative full frame to the whole room (join, roster/status change).
  broadcastSnapshot(room) {
    room.pending = [];
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    room.version += 1;
    this.broadcast(room, this.frame(room));
  }

  // Leading-edge debounce: emit the first change immediately, coalesce a
  // trailing burst into one more batched patch.
  queueChange(room, change) {
    room.pending.push(change);
    if (room.timer) return;

    this.flush(room);

    const tick = () => {
      if (room.pending.length) {
        this.flush(room);
        room.timer = setTimeout(tick, PATCH_DEBOUNCE_MS);
      } else {
        room.timer = null;
      }
    };
    room.timer = setTimeout(tick, PATCH_DEBOUNCE_MS);
  }

  flush(room) {
    if (!room.pending.length) return;
    const changes = room.pending;
    room.pending = [];
    room.version += 1;
    this.broadcast(room, { type: 'game:patch', version: room.version, changes });
  }

  // ---- mutations ------------------------------------------------------

  // Shared by the WS `score:change` handler. Validates against in-memory
  // game meta (no DB read for status/host), writes through to SQLite, then
  // updates memory from the authoritative result and queues a patch.
  async applyScoreChange({ gameId, playerId, changeAmount, userId, clientOpId }) {
    const room = await this.loadRoom(gameId);
    if (!room) throw new ScoreError('Game not found', 404);

    if (typeof changeAmount !== 'number' || Number.isNaN(changeAmount)) {
      throw new ScoreError('changeAmount must be a number', 400);
    }
    if (room.game.status !== 'active') {
      throw new ScoreError(
        room.game.status === 'paused' ? 'Game is paused by the host' : 'Game has ended',
        409
      );
    }
    if (room.game.host_id !== userId && playerId !== userId) {
      throw new ScoreError('Not authorized to update this score', 403);
    }
    if (!room.players.has(playerId)) {
      throw new ScoreError('Player not in game', 404);
    }

    let result;
    try {
      result = await this.db.changePlayerScore(gameId, playerId, changeAmount, userId, clientOpId);
    } catch (err) {
      if (err.message === 'Score cannot be negative') throw new ScoreError(err.message, 400);
      if (err.message === 'Player not in game') throw new ScoreError(err.message, 404);
      throw err;
    }

    const player = room.players.get(playerId);
    player.current_score = result.newScore;

    const history = room.history.get(playerId) || [];
    history.unshift(result.entry);
    room.history.set(playerId, history.slice(0, HISTORY_LIMIT));

    this.queueChange(room, {
      playerId,
      newScore: result.newScore,
      entry: result.entry,
    });

    return result;
  }

  // Called by the REST controllers after they mutate the DB directly
  // (status change, roster change, or a REST score write). Re-hydrates the
  // room from the DB and broadcasts one authoritative full frame. No-op if
  // no one is currently connected to this game.
  async reloadAndBroadcast(gameId) {
    const room = this.rooms.get(gameId);
    if (!room || !room.loaded) return;

    const game = await this.db.getGameById(gameId);
    if (!game) {
      this.rooms.delete(gameId);
      return;
    }

    await this.hydrate(room, game);
    this.broadcastSnapshot(room);
  }

  // Terminate every currently-open socket authenticated as `userId`. `ws.userId`
  // is verified once at connect and cached for the socket's lifetime — REST
  // re-checks the bearer token on every request, but a WebSocket doesn't, so
  // without this an old device keeps live score-write access after its token
  // is invalidated (login elsewhere, logout) until the socket happens to drop
  // on its own. Called right after a token rotation/clear.
  closeSocketsForUser(userId) {
    if (!this.wss) return;
    for (const ws of this.wss.clients) {
      if (ws.userId === userId) ws.terminate();
    }
  }

  // ---- connection & message handling -------------------------------

  handleConnection(ws, req) {
    ws.isAlive = true;
    ws.rooms = new Set();
    ws.userId = null;

    // The bearer token rides as the second WS subprotocol ("bearer, <token>").
    // Verify it once, up front; every message waits on this before it's
    // processed, so `ws.userId` is always the authenticated identity.
    const offered = (req && req.headers['sec-websocket-protocol']) || '';
    const token = offered
      .split(',')
      .map((s) => s.trim())
      .find((s) => s && s !== 'bearer');

    ws.authReady = (async () => {
      if (!token) return;
      try {
        const user = await this.db.getUserBySessionToken(hashToken(token));
        if (user) ws.userId = user.id;
      } catch (err) {
        console.error('WS auth lookup failed:', err);
      }
    })();

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      ws.authReady
        .then(() => this.handleMessage(ws, msg))
        .catch((err) => console.error('ws message error:', err));
    });

    ws.on('close', () => {
      for (const gameId of ws.rooms) {
        const room = this.rooms.get(gameId);
        if (!room) continue;
        room.sockets.delete(ws);
        this.dropRoomIfEmpty(room);
      }
      ws.rooms.clear();
    });

    ws.on('error', () => {
      try {
        ws.close();
      } catch (_) {
        /* ignore */
      }
    });
  }

  async handleMessage(ws, msg) {
    switch (msg && msg.type) {
      case 'join':
        return this.onJoin(ws, msg);
      case 'leave':
        return this.onLeave(ws, msg);
      case 'resync':
        return this.onResync(ws, msg);
      case 'score:change':
        return this.onScoreMessage(ws, msg);
      default:
        return undefined;
    }
  }

  async onJoin(ws, { gameId }) {
    const userId = ws.userId; // authenticated at connection time
    if (!userId) {
      return this.send(ws, { type: 'error', message: 'Unauthorized' });
    }
    if (!gameId) {
      return this.send(ws, { type: 'error', message: 'Missing gameId' });
    }

    const room = await this.loadRoom(gameId);
    if (!room) {
      return this.send(ws, { type: 'error', message: 'Game not found' });
    }

    const isMember = room.players.has(userId) || room.game.host_id === userId;
    if (!isMember) {
      return this.send(ws, { type: 'error', message: 'Not authorized to join this game' });
    }

    room.sockets.add(ws);
    ws.rooms.add(gameId);

    // The joiner may be new; re-hydrate the roster and hand the whole room
    // one fresh authoritative frame.
    const game = await this.db.getGameById(gameId);
    if (game) await this.hydrate(room, game);
    this.broadcastSnapshot(room);
  }

  onLeave(ws, { gameId }) {
    const room = this.rooms.get(gameId);
    if (!room) return;
    room.sockets.delete(ws);
    ws.rooms.delete(gameId);
    this.dropRoomIfEmpty(room);
  }

  onResync(ws, { gameId }) {
    const room = this.rooms.get(gameId);
    if (room && room.sockets.has(ws)) {
      this.send(ws, this.frame(room));
    }
  }

  async onScoreMessage(ws, { gameId, playerId, changeAmount, reqId, clientOpId }) {
    const respond = (payload) => this.send(ws, { type: 'ack', reqId, ...payload });
    if (!ws.userId) {
      return respond({ ok: false, error: 'Unauthorized' });
    }
    try {
      const result = await this.applyScoreChange({
        gameId,
        playerId,
        changeAmount,
        userId: ws.userId,
        clientOpId,
      });
      respond({
        ok: true,
        playerId,
        previousScore: result.previousScore,
        newScore: result.newScore,
      });
    } catch (err) {
      if (err instanceof ScoreError) {
        return respond({ ok: false, error: err.message });
      }
      console.error('score:change failed:', err);
      respond({ ok: false, error: 'Failed to update score' });
    }
  }
}

module.exports = GameHub;
