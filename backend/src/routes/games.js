const express = require('express');
const GameController = require('../controllers/gameController');
const { auth, validateGameName } = require('../middleware/auth');

module.exports = (db, onGameChanged) => {
  const router = express.Router();
  const gameController = new GameController(db, onGameChanged);
  const authed = auth(db);

  // Create new game
  router.post('/', authed, validateGameName, (req, res) =>
    gameController.createGame(req, res)
  );

  // Join existing game (adds the authenticated user to the game)
  router.post('/join', authed, (req, res) => gameController.joinGame(req, res));

  // Get / delete games created by the current user (must come before '/:gameId')
  router.get('/hosted', authed, (req, res) => gameController.getHostedGames(req, res));
  router.delete('/hosted', authed, (req, res) =>
    gameController.deleteHostedGames(req, res)
  );

  // Public game lookups by unguessable id / code (read-only: roster + scores)
  router.get('/code/:code', (req, res) => gameController.getGame(req, res));
  router.get('/:gameId', (req, res) => gameController.getGameById(req, res));

  // Get the current user's games
  router.get('/', authed, (req, res) => gameController.getUserGames(req, res));

  // Update game status (host only)
  router.patch('/:gameId/status', authed, (req, res) =>
    gameController.updateGameStatus(req, res)
  );

  // Remove player from game (host only)
  router.delete('/:gameId/players/:playerId', authed, (req, res) =>
    gameController.removePlayer(req, res)
  );

  return router;
};
