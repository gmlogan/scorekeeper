const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const bodyParser = require('body-parser');
require('dotenv').config();

const { v4: uuidv4 } = require('uuid');

const Database = require('./models/database');
const GameHub = require('./realtime/gameHub');
const gameRoutes = require('./routes/games');
const scoreRoutes = require('./routes/scores');
const authRoutes = require('./routes/auth');
const { auth } = require('./middleware/auth');
const { newSessionToken, hashToken } = require('./lib/token');
const { hashPassword } = require('./lib/password');
const { publicUser } = require('./lib/publicUser');

// Login handle: letters, digits, `._-` only. No `:` — that keeps the
// `guest:<uuid>` namespace used for typed-in (non-account) game players
// (see gameController.js) provably unreachable by a real registration, and
// no whitespace, which sidesteps homoglyph/trim tricks against the
// case-insensitive uniqueness check.
const USERNAME_RE = /^[A-Za-z0-9._-]{2,32}$/;

const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet());
// FRONTEND_URL unset (dev, or same-origin prod deploys where the backend
// serves the built frontend) means there's no separate origin to restrict to.
app.use(cors(process.env.FRONTEND_URL ? { origin: process.env.FRONTEND_URL } : {}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Unauthenticated endpoints (account creation, public game lookup) are the
// only ones an attacker can hit without a token, so they're what a script
// could hammer to exhaust disk (unbounded user/game rows) or brute-force
// the game-code space. 30 req/min/IP is generous for real usage.
const publicEndpointLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Login/set-password guess a secret rather than just mint an identity, so
// they get a much tighter budget than account creation — 10/min/IP.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Database
const db = new Database();

// Realtime: raw WebSocket transport + one in-memory authoritative room per
// active game. See realtime/gameHub.js.
//
// The bearer token is carried as the second WebSocket subprotocol
// ("bearer, <token>") — browsers can't set headers on a WebSocket. The
// server must echo an agreed subprotocol or the browser drops the socket,
// so accept "bearer" whenever it's offered; the token itself is verified
// (against the DB) inside GameHub.handleConnection before any message is
// processed.
const wss = new WebSocketServer({
  server,
  path: '/ws',
  handleProtocols: (protocols) => (protocols.has('bearer') ? 'bearer' : false),
});
const hub = new GameHub(db);
hub.attach(wss);

// REST controllers mutate the DB directly, then signal the hub to re-broadcast.
const onGameChanged = (gameId) => hub.reloadAndBroadcast(gameId);

// Routes
app.use('/api/games/code', publicEndpointLimiter); // unauthenticated code lookup
app.use('/api/games', gameRoutes(db, onGameChanged));
app.use('/api/scores', scoreRoutes(db, onGameChanged));
app.use('/api/auth', authRoutes(db, hub, authLimiter));

// Registration: create an account with a username + password, and mint a
// session token. The token is returned once here and never again; only its
// hash is stored — same for the password, which is never stored at all,
// only a salted scrypt derivation of it (lib/password.js).
app.post('/api/users', publicEndpointLimiter, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username must be 2-32 characters: letters, numbers, "." "_" "-" only',
      });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 8-128 characters' });
    }

    const userId = uuidv4();
    const token = newSessionToken();
    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await db.createUser(userId, username, username, hashToken(token), passwordHash);
    } catch (err) {
      if (/UNIQUE constraint failed: users\.username/i.test(err.message || '')) {
        return res.status(409).json({ error: 'Username is already taken' });
      }
      throw err;
    }

    res.status(201).json({ ...publicUser({ ...user, password_hash: passwordHash }), sessionToken: token });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// Update the authenticated user's display name.
app.patch('/api/users/me', auth(db), async (req, res) => {
  try {
    const { displayName } = req.body;
    if (!displayName || displayName.trim().length < 2) {
      return res.status(400).json({ error: 'Display name must be at least 2 characters' });
    }

    await db.updateUserDisplayName(req.userId, displayName.trim());
    const user = await db.getUserById(req.userId);
    res.json(publicUser(user));
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve the built frontend (copied to /app/public in the Docker image)
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA fallback: any non-API GET route returns index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) next();
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await db.connect();
    console.log('Database connected');

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
});

if (require.main === module) {
  startServer();
}

module.exports = { app, db, server, startServer };
