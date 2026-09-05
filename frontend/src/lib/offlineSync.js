// Offline game state + a durable outbox, backed by localStorage. Small JSON
// blobs, synchronous API — plenty for one device's in-progress games, no new
// dependency (IndexedDB would be pure ceremony at this data size).
//
// Two kinds of state live here:
//  - a per-game snapshot (`og:snapshot:<id>`): the last known { game, players,
//    history }, read back when a page loads with no server connection.
//  - one ordered outbox (`og:queue`): ops queued while offline, replayed in
//    order once reconnected. `create-game` and `score-change` are the only
//    two mutations this app can make without a live connection (see the
//    offline-support plan) — everything else requires validating against the
//    server (joining by code, changing game status) and has no offline path.
import { api } from './apiClient';

const QUEUE_KEY = 'og:queue';
const snapshotKey = (id) => `og:snapshot:${id}`;

const readJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* storage full or unavailable — offline support degrades, not fatal */
  }
};

export const saveGameSnapshot = (id, snapshot) => writeJSON(snapshotKey(id), snapshot);
export const loadGameSnapshot = (id) => readJSON(snapshotKey(id), null);
export const deleteGameSnapshot = (id) => {
  try {
    localStorage.removeItem(snapshotKey(id));
  } catch (_) {
    /* ignore */
  }
};

const loadQueue = () => readJSON(QUEUE_KEY, []);
const saveQueue = (queue) => writeJSON(QUEUE_KEY, queue);

const genId = () => `op-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

// `op`: { type: 'create-game' | 'score-change', payload }. Persisted
// immediately so a killed tab never drops a queued tap.
export const enqueueOp = (op) => {
  const id = genId();
  const queue = loadQueue();
  queue.push({ id, ...op });
  saveQueue(queue);
  return id;
};

// Rewrites any queued op referencing a since-synced local game id to its
// real server id — called right after a queued `create-game` resolves, so
// score changes queued against it (in the same session) target the right
// game on their own turn through the queue.
const remapQueueGameId = (fromId, toId) => {
  const queue = loadQueue();
  let changed = false;
  for (const op of queue) {
    if (op.payload && op.payload.gameId === fromId) {
      op.payload.gameId = toId;
      changed = true;
    }
  }
  if (changed) saveQueue(queue);
};

export const hasQueuedOps = () => loadQueue().length > 0;

const applyOp = async (op, { emitScoreChange }) => {
  if (op.type === 'create-game') {
    try {
      const { name, players, targetScore, timeLimit } = op.payload;
      const res = await api.post('/games', { name, players, targetScore, timeLimit });
      return { kind: 'created', game: res.data };
    } catch (err) {
      // A 4xx means the server actively rejected it (and we ARE connected) —
      // retrying the same payload won't succeed. Anything else (no response,
      // 5xx) is transient: stop the flush and try again next reconnect.
      if (err.response && err.response.status < 500) return { kind: 'drop' };
      throw err;
    }
  }

  if (op.type === 'score-change') {
    const { gameId, playerId, changeAmount } = op.payload;
    const res = await emitScoreChange(gameId, playerId, changeAmount, op.id);
    if (res.ok) return { kind: 'done' };
    // The ack timeout is the one WS failure mode that means "still offline" —
    // every other ack error (paused/finished game, player removed, negative
    // score) is a real, permanent rejection from the server.
    if (res.error === 'Timed out waiting for the server') throw new Error('offline');
    return { kind: 'drop', error: res.error };
  }

  return { kind: 'drop' };
};

let flushing = false;

// Walks the queue in order. Stops (leaving the remainder queued) the moment
// an op can't be resolved either way yet (still offline); drops an op that
// succeeded or was permanently rejected, then continues. Call once per
// reconnect — see GameContext's isConnected effect.
export const flushQueue = async ({ emitScoreChange, onGameCreated, onOpDropped }) => {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const queue = loadQueue();
      if (!queue.length) break;
      const op = queue[0];

      let outcome;
      try {
        outcome = await applyOp(op, { emitScoreChange });
      } catch (_) {
        break; // still offline (or flaky) — keep this op and everything after it queued
      }

      if (outcome.kind === 'created') {
        remapQueueGameId(op.payload.localId, outcome.game.id);
        onGameCreated?.(op.payload.localId, outcome.game);
      } else if (outcome.kind === 'drop' && outcome.error) {
        onOpDropped?.(op, outcome.error);
      }

      saveQueue(loadQueue().filter((o) => o.id !== op.id));
    }
  } finally {
    flushing = false;
  }
};
