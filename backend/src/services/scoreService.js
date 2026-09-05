// Shared score-mutation logic used by BOTH the REST controller and the
// WebSocket `score:change` handler, so authorization and validation can
// never drift between the two transports.

class ScoreError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ScoreError';
    this.status = status;
  }
}

const assertGameWritable = (game) => {
  if (!game) throw new ScoreError('Game not found', 404);
  if (game.status !== 'active') {
    throw new ScoreError(
      game.status === 'paused' ? 'Game is paused by the host' : 'Game has ended',
      409
    );
  }
};

const assertCanEdit = (game, playerId, userId) => {
  const isHost = game.host_id === userId;
  const isOwnScore = playerId === userId;
  if (!isHost && !isOwnScore) {
    throw new ScoreError('Not authorized to update this score', 403);
  }
};

const mapDbError = (error) => {
  if (error.message === 'Player not in game') return new ScoreError(error.message, 404);
  if (error.message === 'Score cannot be negative') return new ScoreError(error.message, 400);
  return error;
};

// Apply a relative change (+/-) to a player's score. `clientOpId`, when
// present, makes a retried call (e.g. an offline-queued change replayed
// after a dropped ack) idempotent — see Database.changePlayerScore.
const applyScoreChange = async (db, { gameId, playerId, changeAmount, userId, clientOpId }) => {
  if (typeof changeAmount !== 'number' || Number.isNaN(changeAmount)) {
    throw new ScoreError('changeAmount must be a number', 400);
  }

  const game = await db.getGameById(gameId);
  assertGameWritable(game);
  assertCanEdit(game, playerId, userId);

  try {
    return await db.changePlayerScore(gameId, playerId, changeAmount, userId, clientOpId);
  } catch (error) {
    throw mapDbError(error);
  }
};

// Set a player's score to an absolute value.
const applyScoreSet = async (db, { gameId, playerId, score, userId }) => {
  if (typeof score !== 'number' || Number.isNaN(score) || score < 0) {
    throw new ScoreError('Score must be a non-negative number', 400);
  }

  const game = await db.getGameById(gameId);
  assertGameWritable(game);
  assertCanEdit(game, playerId, userId);

  try {
    return await db.setPlayerScore(gameId, playerId, score, userId);
  } catch (error) {
    throw mapDbError(error);
  }
};

module.exports = { ScoreError, applyScoreChange, applyScoreSet };
