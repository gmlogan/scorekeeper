const express = require('express');
const cors = require('cors');
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
const { auth } = require('./middleware/auth');
const { newSessionToken, hashToken } = require('./lib/token');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
app.use('/api/games', gameRoutes(db, onGameChanged));
app.use('/api/scores', scoreRoutes(db, onGameChanged));

// Registration: mint a fresh anonymous identity + session token. The token is
// returned once here and never again; only its hash is stored.
app.post('/api/users', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    if (username.length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters' });
    }

    const userId = uuidv4();
    const token = newSessionToken();
    const user = await db.createUser(userId, username, username, hashToken(token));

    res.status(201).json({ ...user, sessionToken: token });
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
    res.json(user);
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
