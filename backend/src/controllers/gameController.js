const { v4: uuidv4 } = require('uuid');

class GameController {
  constructor(db) {
    this.db = db;
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

      console.log('Create game request:', { name, players, targetScore, timeLimit, hostId });

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

      console.log('Generated game code:', code);

      await this.db.createGame(
        gameId,
        code,
        name,
        hostId,
        targetScore || null,
        timeLimit || null
      );

      console.log('Game created:', gameId);

      // Add host as first player
      const hostGamePlayerId = uuidv4();
      await this.db.addPlayerToGame(hostGamePlayerId, gameId, hostId);

      console.log('Host added as player');

      // Add other players if provided
      if (players && Array.isArray(players)) {
        for (const playerName of players) {
          const playerId = uuidv4();
          try {
            await this.db.createUser(playerId, playerName, playerName);
            const playerGamePlayerId = uuidv4();
            await this.db.addPlayerToGame(playerGamePlayerId, gameId, playerId);
          } catch (err) {
            // User might already exist
            const existingUser = await this.db.getUserByUsername(playerName);
            if (existingUser) {
              const playerGamePlayerId = uuidv4();
              await this.db.addPlayerToGame(playerGamePlayerId, gameId, existingUser.id);
            }
          }
        }
      }

      console.log('Other players added');

      const gameData = await this.db.getGameById(gameId);
      const gamePlayers = await this.db.getGamePlayers(gameId);

      console.log('Game response:', { gameData, gamePlayers });

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
      const { code, username } = req.body;

      console.log('Join game request:', { code, username });

      if (!code || !username) {
        return res.status(400).json({ error: 'Code and username are required' });
      }

      const game = await this.db.getGameByCode(code);
      console.log('Game found by code:', game);
      
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      // Create or get user
      let user = await this.db.getUserByUsername(username);
      if (!user) {
        const newUserId = uuidv4();
        user = await this.db.createUser(newUserId, username, username);
        console.log('New user created:', user);
      } else {
        console.log('Existing user found:', user);
      }

      // Add player to game
      const gamePlayerId = uuidv4();
      await this.db.addPlayerToGame(gamePlayerId, game.id, user.id);
      console.log('Player added to game');

      const gamePlayers = await this.db.getGamePlayers(game.id);
      console.log('Game players fetched:', gamePlayers);

      const response = {
        game,
        players: gamePlayers,
        userId: user.id
      };
      
      console.log('Join game response:', response);

      res.status(200).json(response);
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

      res.json({ players: gamePlayers });
    } catch (error) {
      console.error('Error removing player:', error);
      res.status(500).json({ error: 'Failed to remove player' });
    }
  }
}

module.exports = GameController;
