// Authentication middleware
const auth = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const sessionToken = req.headers['x-session-token'];

  if (!userId || !sessionToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.userId = userId;
  req.sessionToken = sessionToken;
  next();
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

const validateUsername = (req, res, next) => {
  const username = req.body.username;
  if (!username || username.trim().length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  }
  next();
};

module.exports = {
  auth,
  validateGameCode,
  validateGameName,
  validateUsername
};
