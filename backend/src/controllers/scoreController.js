const { ScoreError, applyScoreChange, applyScoreSet } = require('../services/scoreService');

class ScoreController {
  // `onScoreChanged(gameId)` is a signal to the realtime layer that this
  // game's state should be re-broadcast. It carries no payload — the
  // broadcaster reads the authoritative state itself.
  constructor(db, onScoreChanged = () => {}) {
    this.db = db;
    this.onScoreChanged = onScoreChanged;
  }

  async updateScore(req, res) {
    try {
      const { gameId, playerId } = req.params;
      const { changeAmount } = req.body;

      const result = await applyScoreChange(this.db, {
        gameId,
        playerId,
        changeAmount,
        userId: req.userId,
      });

      this.onScoreChanged(gameId);

      res.json({
        playerId,
        previousScore: result.previousScore,
        newScore: result.newScore,
        changeAmount: result.newScore - result.previousScore,
      });
    } catch (error) {
      if (error instanceof ScoreError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error updating score:', error);
      res.status(500).json({ error: 'Failed to update score' });
    }
  }

  async setScore(req, res) {
    try {
      const { gameId, playerId } = req.params;
      const { score } = req.body;

      const result = await applyScoreSet(this.db, {
        gameId,
        playerId,
        score,
        userId: req.userId,
      });

      this.onScoreChanged(gameId);

      res.json({
        playerId,
        previousScore: result.previousScore,
        newScore: result.newScore,
        changeAmount: result.newScore - result.previousScore,
      });
    } catch (error) {
      if (error instanceof ScoreError) {
        return res.status(error.status).json({ error: error.message });
      }
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
        players,
      });
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  }
}

module.exports = ScoreController;
