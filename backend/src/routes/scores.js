const express = require('express');
const ScoreController = require('../controllers/scoreController');
const { auth } = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router();
  const scoreController = new ScoreController(db);

  // Update score (add/subtract)
  router.post('/games/:gameId/players/:playerId/update', auth, (req, res) =>
    scoreController.updateScore(req, res)
  );

  // Set score (absolute value)
  router.post('/games/:gameId/players/:playerId/set', auth, (req, res) =>
    scoreController.setScore(req, res)
  );

  // Get score history for player
  router.get('/games/:gameId/players/:playerId/history', (req, res) =>
    scoreController.getScoreHistory(req, res)
  );

  // Get leaderboard for game
  router.get('/games/:gameId/leaderboard', (req, res) =>
    scoreController.getLeaderboard(req, res)
  );

  return router;
};
