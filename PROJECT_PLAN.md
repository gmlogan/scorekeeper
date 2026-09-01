# Scorecard App - Project Plan

## Overview
A real-time multiplayer scorecard tracking application built as a PWA with React frontend and Node.js/SQLite backend, deployable via Docker.

## Core Features

### Game Management
- **Host creates game** with custom name/settings
- **Shareable game code** (6-char alphanumeric) for players to join
- **Real-time score updates** across all connected players
- **Game states**: Active, Paused, Finished

### Player Functionality
- **Join game** via shareable code
- **Edit own score** with add/subtract interface
- **View score history** (last 3 scores)
- **See live leaderboard** of all players

### Host Functionality
- **Edit any player's score** (override capability)
- **Remove players** from game
- **View all score histories**
- **Manage game state** (pause/resume/end)

### Score Entry
- Simple interface to add/subtract values from running score
- Input validation and confirmation
- Score history tracking (timestamps, edit history)

## Tech Stack

### Frontend (PWA - React)
- React 18
- PWA capabilities (offline support, installable)
- WebSocket for real-time updates
- TailwindCSS for styling
- State management (Context API or Redux)

### Backend (Node.js)
- Express.js
- WebSocket (Socket.io) for real-time communication
- SQLite3 for data persistence
- JWT for session management

### Infrastructure
- Docker (single container with both frontend and backend)
- Docker Compose for development
- Environment-based configuration

## Database Schema

### Tables
1. **games**
   - id (PK)
   - code (unique, 6-char)
   - name
   - host_id (FK to users)
   - status (active/paused/finished)
   - created_at
   - updated_at

2. **game_players**
   - id (PK)
   - game_id (FK)
   - player_id (FK to users)
   - current_score
   - joined_at

3. **score_history**
   - id (PK)
   - game_id (FK)
   - player_id (FK)
   - previous_score
   - new_score
   - change_amount
   - edited_by_id (FK to users - who made the edit)
   - timestamp

4. **users**
   - id (PK)
   - username
   - session_token
   - created_at

## API Endpoints

### Game Management
- `POST /api/games` - Create new game
- `GET /api/games/:code` - Get game details
- `POST /api/games/:code/join` - Player joins game
- `PATCH /api/games/:code` - Update game (host only)

### Score Management
- `POST /api/games/:gameId/scores` - Update player score
- `GET /api/games/:gameId/players/:playerId/history` - Get score history
- `GET /api/games/:gameId/leaderboard` - Get all players and scores

### Real-time (WebSocket)
- `score_updated` - Player score changed
- `player_joined` - New player joined
- `player_left` - Player left game
- `game_state_changed` - Game paused/resumed/ended

## Project Structure

```
scorecard-claude/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── GameCreate.jsx
│   │   │   ├── GameJoin.jsx
│   │   │   ├── GameBoard.jsx
│   │   │   ├── Leaderboard.jsx
│   │   │   ├── ScoreEntry.jsx
│   │   │   ├── ScoreHistory.jsx
│   │   │   └── Navigation.jsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.js
│   │   │   └── useGame.js
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── Game.jsx
│   │   │   └── NotFound.jsx
│   │   ├── context/
│   │   │   └── GameContext.js
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── index.js
│   ├── public/
│   │   ├── manifest.json
│   │   ├── service-worker.js
│   │   └── index.html
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── gameController.js
│   │   │   └── scoreController.js
│   │   ├── models/
│   │   │   └── database.js
│   │   ├── routes/
│   │   │   ├── games.js
│   │   │   └── scores.js
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   └── validation.js
│   │   ├── websocket/
│   │   │   └── handlers.js
│   │   └── server.js
│   ├── database/
│   │   ├── schema.sql
│   │   └── init.js
│   └── package.json
├── Dockerfile
├── docker-compose.yml
├── package.json (root)
└── README.md
```

## Development Phases

1. **Phase 1**: Backend setup (Express, SQLite, API)
2. **Phase 2**: WebSocket integration
3. **Phase 3**: React frontend structure
4. **Phase 4**: Game creation and joining flows
5. **Phase 5**: Score management and UI
6. **Phase 5**: PWA configuration
7. **Phase 6**: Docker containerization
8. **Phase 7**: Testing and deployment

## Next Steps
1. Await screenshot guidance for UI/UX reference
2. Initialize project with npm/git
3. Set up backend server and database
4. Build API endpoints
5. Create React components
6. Implement WebSocket real-time features
7. Add PWA capabilities
8. Dockerize the application
