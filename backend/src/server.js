const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const bodyParser = require('body-parser');
require('dotenv').config();

const Database = require('./models/database');
const gameRoutes = require('./routes/games');
const scoreRoutes = require('./routes/scores');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database
const db = new Database();

// Store active connections
const gameConnections = {};
const pendingScoreUpdates = new Map();
const SCORE_BROADCAST_INTERVAL = 2000;

const broadcastScoreUpdate = (gameId, update) => {
  const pending = pendingScoreUpdates.get(gameId) || new Map();
  pending.set(update.playerId, update);
  pendingScoreUpdates.set(gameId, pending);

  if (pending.timer) return;
  pending.timer = setTimeout(() => {
    const updates = Array.from(pending.entries())
      .filter(([key]) => key !== 'timer')
      .map(([, value]) => value);
    pendingScoreUpdates.delete(gameId);
    io.to(`game-${gameId}`).emit('scores-updated', {
      updates,
      timestamp: new Date(),
    });
  }, SCORE_BROADCAST_INTERVAL);
};

// WebSocket handlers
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join game room
  socket.on('join-game', async (data) => {
    const { gameId, userId } = data;
    if (!gameId || !userId) {
      return socket.emit('error', { message: 'Missing gameId or userId' });
    }

    const game = await db.getGameById(gameId);
    if (!game) {
      return socket.emit('error', { message: 'Game not found' });
    }

    const players = await db.getGamePlayers(gameId);
    const isMember = players.some((player) => player.player_id === userId) || game.host_id === userId;
    if (!isMember) {
      return socket.emit('error', { message: 'Not authorized to join this game' });
    }

    const room = `game-${gameId}`;
    socket.join(room);
    socket.data.userId = userId;

    if (!gameConnections[gameId]) {
      gameConnections[gameId] = [];
    }
    if (!gameConnections[gameId].some((c) => c.socketId === socket.id)) {
      gameConnections[gameId].push({ socketId: socket.id, userId });
    }

    // Notify everyone else in the room (not the sender)
    socket.to(room).emit('player-joined', { userId });
    console.log(`User ${userId} joined game ${gameId}`);
  });

  // Game state changed
  socket.on('game-state-changed', async (data) => {
    const { gameId, status, userId } = data;
    if (!gameId || !status || !userId) {
      return socket.emit('error', { message: 'Missing gameId, status, or userId' });
    }

    const game = await db.getGameById(gameId);
    if (!game || game.host_id !== userId) {
      return socket.emit('error', { message: 'Only the host can change game state' });
    }

    const room = `game-${gameId}`;
    io.to(room).emit('game-state-changed', { status, timestamp: new Date() });
  });

  // Player left
  socket.on('leave-game', (data) => {
    const { gameId, userId } = data;
    const room = `game-${gameId}`;

    if (gameConnections[gameId]) {
      gameConnections[gameId] = gameConnections[gameId].filter(
        (conn) => conn.socketId !== socket.id
      );
      if (gameConnections[gameId].length === 0) delete gameConnections[gameId];
    }

    io.to(room).emit('player-left', { userId });
    socket.leave(room);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Clean up connections
    Object.keys(gameConnections).forEach((gameId) => {
      const connection = gameConnections[gameId].find((conn) => conn.socketId === socket.id);
      if (!connection) return;
      gameConnections[gameId] = gameConnections[gameId].filter(
        (conn) => conn.socketId !== socket.id
      );
      socket.to(`game-${gameId}`).emit('player-left', { userId: connection.userId });
      if (gameConnections[gameId].length === 0) delete gameConnections[gameId];
    });
  });
});

// Routes
app.use('/api/games', gameRoutes(db));
app.use('/api/scores', scoreRoutes(db, broadcastScoreUpdate));

// User creation endpoint
app.post('/api/users', async (req, res) => {
  try {
    const { username } = req.body;
    const userId = req.headers['x-user-id'];

    if (!username || !userId) {
      return res.status(400).json({ error: 'Username and user ID required' });
    }

    // Check if user already exists
    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return res.json(existingUser);
    }

    // Create new user
    const user = await db.createUser(userId, username, username);
    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// Update current user's display name
app.patch('/api/users/me', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const sessionToken = req.headers['x-session-token'];
    const { displayName } = req.body;

    if (!userId || !sessionToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!displayName || displayName.trim().length < 2) {
      return res.status(400).json({ error: 'Display name must be at least 2 characters' });
    }

    await db.updateUserDisplayName(userId, displayName.trim());
    const user = await db.getUserById(userId);
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
