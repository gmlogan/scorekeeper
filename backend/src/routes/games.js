const express = require('express');
const GameController = require('../controllers/gameController');
const { auth, validateGameName } = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router();
  const gameController = new GameController(db);

  // Create new game
  router.post('/', auth, validateGameName, (req, res) =>
    gameController.createGame(req, res)
  );

  // Join existing game
  router.post('/join', (req, res) => gameController.joinGame(req, res));

  // Get / delete games created by the current user (must come before '/:gameId')
  router.get('/hosted', auth, (req, res) => gameController.getHostedGames(req, res));
  router.delete('/hosted', auth, (req, res) =>
    gameController.deleteHostedGames(req, res)
  );

  // Get game by code
  router.get('/code/:code', (req, res) => gameController.getGame(req, res));

  // Get game by ID
  router.get('/:gameId', (req, res) => gameController.getGameById(req, res));

  // Get user's games
  router.get('/', auth, (req, res) => gameController.getUserGames(req, res));

  // Update game status (host only)
  router.patch('/:gameId/status', auth, (req, res) =>
    gameController.updateGameStatus(req, res)
  );

  // Remove player from game (host only)
  router.delete('/:gameId/players/:playerId', auth, (req, res) =>
    gameController.removePlayer(req, res)
  );

  return router;
};
