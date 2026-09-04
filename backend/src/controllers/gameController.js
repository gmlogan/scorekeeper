const { v4: uuidv4 } = require('uuid');

class GameController {
  // `onGameChanged(gameId)` signals the realtime layer to re-broadcast this
  // game's state (roster / status changes made over REST).
  constructor(db, onGameChanged = () => {}) {
    this.db = db;
    this.onGameChanged = onGameChanged;
  }

  // Generate unique game code (format: ABC-1234)
  generateGameCode() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letters3 = Array.from({ length: 3 }, () =>
      letters[Math.floor(Math.random() * letters.length)]
    ).join('');
    const numbers = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `${letters3}-${numbers}`;
  }

  async createGame(req, res) {
    try {
      const { name, players, targetScore, timeLimit } = req.body;
      const hostId = req.userId;

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Game name is required' });
      }

      const gameId = uuidv4();
      let code;
      let codeExists = true;

      // Ensure unique code
      while (codeExists) {
        code = this.generateGameCode();
        const existing = await this.db.getGameByCode(code);
        codeExists = !!existing;
      }

      await this.db.createGame(
        gameId,
        code,
        name,
        hostId,
        targetScore || null,
        timeLimit || null
      );

      // Add host as first player
      const hostGamePlayerId = uuidv4();
      await this.db.addPlayerToGame(hostGamePlayerId, gameId, hostId);

      // Add other players if provided. These are typed-in names, not
      // accounts — give each a non-colliding `guest:<uuid>` username (never
      // a real login handle, so it can never be logged into) and put the
      // typed name in display_name, which is all the UI ever renders. Now
      // that usernames are login credentials, looking one up by the typed
      // name (as this used to, on insert conflict) would silently attach a
      // real stranger's account to this game whenever a typed name happened
      // to match their handle.
      if (players && Array.isArray(players)) {
        for (const playerName of players) {
          const playerId = uuidv4();
          await this.db.createUser(playerId, `guest:${playerId}`, playerName);
          await this.db.addPlayerToGame(uuidv4(), gameId, playerId);
        }
      }

      const gameData = await this.db.getGameById(gameId);
      const gamePlayers = await this.db.getGamePlayers(gameId);

      res.status(201).json({
        ...gameData,
        players: gamePlayers
      });
    } catch (error) {
      console.error('Error creating game:', error);
      res.status(500).json({ error: error.message || 'Failed to create game' });
    }
  }

  async joinGame(req, res) {
    try {
      const { code } = req.body;
      const userId = req.userId; // authenticated

      if (!code) {
        return res.status(400).json({ error: 'Game code is required' });
      }

      const game = await this.db.getGameByCode(code);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      // Add the authenticated user to the game (idempotent — re-joining is fine).
      const roster = await this.db.getGamePlayers(game.id);
      if (!roster.some((p) => p.player_id === userId)) {
        await this.db.addPlayerToGame(uuidv4(), game.id, userId);
      }

      const gamePlayers = await this.db.getGamePlayers(game.id);

      this.onGameChanged(game.id);

      res.status(200).json({
        game,
        players: gamePlayers,
        userId,
      });
    } catch (error) {
      console.error('Error joining game:', error);
      res.status(500).json({ error: error.message || 'Failed to join game' });
    }
  }

  async getGame(req, res) {
    try {
      const { code } = req.params;

      const game = await this.db.getGameByCode(code);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const gamePlayers = await this.db.getGamePlayers(game.id);

      res.json({
        game,
        players: gamePlayers
      });
    } catch (error) {
      console.error('Error fetching game:', error);
      res.status(500).json({ error: 'Failed to fetch game' });
    }
  }

  async getGameById(req, res) {
    try {
      const { gameId } = req.params;

      const game = await this.db.getGameById(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const gamePlayers = await this.db.getGamePlayers(game.id);

      res.json({
        game,
        players: gamePlayers
      });
    } catch (error) {
      console.error('Error fetching game:', error);
      res.status(500).json({ error: 'Failed to fetch game' });
    }
  }

  async getUserGames(req, res) {
    try {
      const userId = req.userId;
      const games = await this.db.getGamesByUserId(userId);

      // Enrich with player counts
      const enrichedGames = await Promise.all(
        games.map(async (game) => {
          const players = await this.db.getGamePlayers(game.id);
          return {
            ...game,
            playerCount: players.length,
            players
          };
        })
      );

      res.json(enrichedGames);
    } catch (error) {
      console.error('Error fetching user games:', error);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  }

  async getHostedGames(req, res) {
    try {
      const userId = req.userId;
      const games = await this.db.getGamesByHostId(userId);

      const enrichedGames = await Promise.all(
        games.map(async (game) => {
          const players = await this.db.getGamePlayers(game.id);
          return {
            ...game,
            playerCount: players.length,
            players
          };
        })
      );

      res.json(enrichedGames);
    } catch (error) {
      console.error('Error fetching hosted games:', error);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  }

  async deleteHostedGames(req, res) {
    try {
      const userId = req.userId;
      const deleted = await this.db.deleteGamesByHostId(userId);
      res.json({ deleted });
    } catch (error) {
      console.error('Error deleting hosted games:', error);
      res.status(500).json({ error: 'Failed to delete games' });
    }
  }

  async updateGameStatus(req, res) {
    try {
      const { gameId } = req.params;
      const { status } = req.body;
      const userId = req.userId;

      const game = await this.db.getGameById(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      if (game.host_id !== userId) {
        return res.status(403).json({ error: 'Only host can update game status' });
      }

      if (!['active', 'paused', 'finished'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      await this.db.updateGameStatus(gameId, status);
      const updated = await this.db.getGameById(gameId);

      this.onGameChanged(gameId);

      res.json(updated);
    } catch (error) {
      console.error('Error updating game status:', error);
      res.status(500).json({ error: 'Failed to update game' });
    }
  }

  async removePlayer(req, res) {
    try {
      const { gameId, playerId } = req.params;
      const userId = req.userId;

      const game = await this.db.getGameById(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      if (game.host_id !== userId) {
        return res.status(403).json({ error: 'Only host can remove players' });
      }

      await this.db.removePlayerFromGame(gameId, playerId);
      const gamePlayers = await this.db.getGamePlayers(gameId);

      this.onGameChanged(gameId);

      res.json({ players: gamePlayers });
    } catch (error) {
      console.error('Error removing player:', error);
      res.status(500).json({ error: 'Failed to remove player' });
    }
  }
}

module.exports = GameController;
