class ScoreController {
  constructor(db) {
    this.db = db;
  }

  async updateScore(req, res) {
    try {
      const { gameId, playerId } = req.params;
      const { changeAmount } = req.body;
      const userId = req.userId;

      if (typeof changeAmount !== 'number') {
        return res.status(400).json({ error: 'changeAmount must be a number' });
      }

      const game = await this.db.getGameById(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      if (game.status !== 'active') {
        return res.status(409).json({
          error:
            game.status === 'paused'
              ? 'Game is paused by the host'
              : 'Game has ended',
        });
      }

      // Check if user is host or the player themselves
      const isHost = game.host_id === userId;
      const isOwnScore = playerId === userId;

      if (!isHost && !isOwnScore) {
        return res.status(403).json({ error: 'Not authorized to update this score' });
      }

      // Get current score
      const gamePlayer = await new Promise((resolve, reject) => {
        this.db.db.get(
          'SELECT current_score FROM game_players WHERE game_id = ? AND player_id = ?',
          [gameId, playerId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!gamePlayer) {
        return res.status(404).json({ error: 'Player not in game' });
      }

      const newScore = gamePlayer.current_score + changeAmount;

      if (newScore < 0) {
        return res.status(400).json({ error: 'Score cannot be negative' });
      }

      const result = await this.db.updatePlayerScore(
        gameId,
        playerId,
        newScore,
        changeAmount,
        userId
      );

      res.json({
        playerId,
        previousScore: result.previousScore,
        newScore: result.newScore,
        changeAmount
      });
    } catch (error) {
      console.error('Error updating score:', error);
      res.status(500).json({ error: 'Failed to update score' });
    }
  }

  async setScore(req, res) {
    try {
      const { gameId, playerId } = req.params;
      const { score } = req.body;
      const userId = req.userId;

      if (typeof score !== 'number' || score < 0) {
        return res.status(400).json({ error: 'Score must be a non-negative number' });
      }

      const game = await this.db.getGameById(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      if (game.status !== 'active') {
        return res.status(409).json({
          error:
            game.status === 'paused'
              ? 'Game is paused by the host'
              : 'Game has ended',
        });
      }

      // Check if user is host or the player themselves
      const isHost = game.host_id === userId;
      const isOwnScore = playerId === userId;

      if (!isHost && !isOwnScore) {
        return res.status(403).json({ error: 'Not authorized to update this score' });
      }

      // Get current score
      const gamePlayer = await new Promise((resolve, reject) => {
        this.db.db.get(
          'SELECT current_score FROM game_players WHERE game_id = ? AND player_id = ?',
          [gameId, playerId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!gamePlayer) {
        return res.status(404).json({ error: 'Player not in game' });
      }

      const changeAmount = score - gamePlayer.current_score;

      const result = await this.db.updatePlayerScore(
        gameId,
        playerId,
        score,
        changeAmount,
        userId
      );

      res.json({
        playerId,
        previousScore: result.previousScore,
        newScore: result.newScore,
        changeAmount
      });
    } catch (error) {
      console.error('Error setting score:', error);
      res.status(500).json({ error: 'Failed to set score' });
    }
  }

  async getScoreHistory(req, res) {
    try {
      const { gameId, playerId } = req.params;

      const game = await this.db.getGameById(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const history = await this.db.getScoreHistory(gameId, playerId, 10);

      res.json(history);
    } catch (error) {
      console.error('Error fetching score history:', error);
      res.status(500).json({ error: 'Failed to fetch score history' });
    }
  }

  async getLeaderboard(req, res) {
    try {
      const { gameId } = req.params;

      const game = await this.db.getGameById(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const players = await this.db.getGamePlayers(gameId);

      res.json({
        gameId,
        gameName: game.name,
        players
      });
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  }
}

module.exports = ScoreController;
