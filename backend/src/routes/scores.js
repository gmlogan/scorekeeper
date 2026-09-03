const express = require('express');
const ScoreController = require('../controllers/scoreController');
const { auth } = require('../middleware/auth');

module.exports = (db, onScoreChanged) => {
  const router = express.Router();
  const scoreController = new ScoreController(db, onScoreChanged);
  const authed = auth(db);

  // Update score (add/subtract)
  router.post('/games/:gameId/players/:playerId/update', authed, (req, res) =>
    scoreController.updateScore(req, res)
  );

  // Set score (absolute value)
  router.post('/games/:gameId/players/:playerId/set', authed, (req, res) =>
    scoreController.setScore(req, res)
  );

  // Get score history for player
  router.get('/games/:gameId/players/:playerId/history', authed, (req, res) =>
    scoreController.getScoreHistory(req, res)
  );

  // Get leaderboard for game
  router.get('/games/:gameId/leaderboard', authed, (req, res) =>
    scoreController.getLeaderboard(req, res)
  );

  return router;
};
