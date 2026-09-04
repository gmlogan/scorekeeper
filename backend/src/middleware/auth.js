const { hashToken } = require('../lib/token');

// Authentication middleware factory. Verifies the bearer token against the
// hash stored for that user, and sets `req.userId` from the *verified* row —
// never from a client-supplied id.
//
// Accepts either `Authorization: Bearer <token>` (preferred) or the legacy
// `x-session-token` header.
const auth = (db) => async (req, res, next) => {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = bearer || req.headers['x-session-token'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await db.getUserBySessionToken(hashToken(token));
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userId = user.id;
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth lookup failed:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

// Validation middleware
const validateGameCode = (req, res, next) => {
  const code = req.params.code || req.body.code;
  if (!code || !/^[A-Z]{3}-\d{4}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid game code format' });
  }
  next();
};

const validateGameName = (req, res, next) => {
  const name = req.body.name;
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Game name is required' });
  }
  next();
};

module.exports = {
  auth,
  validateGameCode,
  validateGameName,
};
