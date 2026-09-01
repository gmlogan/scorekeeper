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

// WebSocket handlers
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join game room
  socket.on('join-game', (data) => {
    const { gameId, userId } = data;
    const room = `game-${gameId}`;
    socket.join(room);

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

  // Score updated
  socket.on('score-updated', (data) => {
    const { gameId, playerId, newScore, changeAmount, editedBy } = data;
    const room = `game-${gameId}`;
    // Sender already updated its own UI; notify only the others
    socket.to(room).emit('score-updated', {
      playerId,
      newScore,
      changeAmount,
      editedBy,
      timestamp: new Date()
    });
  });

  // Game state changed
  socket.on('game-state-changed', (data) => {
    const { gameId, status } = data;
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
    }

    io.to(room).emit('player-left', { userId });
    socket.leave(room);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Clean up connections
    Object.keys(gameConnections).forEach((gameId) => {
      gameConnections[gameId] = gameConnections[gameId].filter(
        (conn) => conn.socketId !== socket.id
      );
    });
  });
});

// Routes
app.use('/api/games', gameRoutes(db));
app.use('/api/scores', scoreRoutes(db));

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

// Start server
const PORT = process.env.PORT || 5000;

(async () => {
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
})();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
});
