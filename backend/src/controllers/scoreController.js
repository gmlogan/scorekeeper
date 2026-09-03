class ScoreController {
  constructor(db, onScoreUpdated = () => {}) {
    this.db = db;
    this.onScoreUpdated = onScoreUpdated;
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

      let result;
      try {
        result = await this.db.changePlayerScore(gameId, playerId, changeAmount, userId);
      } catch (error) {
        if (error.message === 'Player not in game') {
          return res.status(404).json({ error: error.message });
        }
        if (error.message === 'Score cannot be negative') {
          return res.status(400).json({ error: error.message });
        }
        throw error;
      }

      this.onScoreUpdated(gameId, {
        playerId,
        newScore: result.newScore,
        editedBy: userId,
      });

      res.json({
        playerId,
        previousScore: result.previousScore,
        newScore: result.newScore,
        changeAmount: result.newScore - result.previousScore
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

      let result;
      try {
        result = await this.db.setPlayerScore(gameId, playerId, score, userId);
      } catch (error) {
        if (error.message === 'Player not in game') {
          return res.status(404).json({ error: error.message });
        }
        throw error;
      }
      this.onScoreUpdated(gameId, { playerId, newScore: result.newScore, editedBy: userId });

      res.json({
        playerId,
        previousScore: result.previousScore,
        newScore: result.newScore,
        changeAmount: result.newScore - result.previousScore
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
