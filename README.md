# 🎯 Scorecard App - Real-Time Multiplayer Score Tracking PWA

A modern Progressive Web App for tracking scores in real-time during games and competitions. Built with React, Node.js, and SQLite, deployed via Docker.

## ✨ Features

### For Players
- 🎮 **Join Games** - Enter a shareable game code to join
- 📊 **Track Scores** - Edit your own scores with add/subtract interface
- 📈 **Score History** - View your last 3 scores to correct mistakes
- 👥 **Live Leaderboard** - See real-time rankings of all players
- 📱 **Progressive Web App** - Install on any device, works offline

### For Game Hosts
- 🎲 **Create Games** - Set up a new game with custom rules
- 👥 **Manage Players** - Add/remove players and customize settings
- 📋 **Edit Any Score** - Override any player's score
- ⏸️ **Control Game** - Pause, resume, or end games
- 🔗 **Share Code** - Generate unique game codes for inviting players
- ⚙️ **Game Rules** - Set target scores and time limits

### Technical Features
- ⚡ **Real-Time Updates** - WebSocket for instant score synchronization
- 🔄 **Offline Support** - Service Worker caches game state
- 🎨 **Responsive Design** - Mobile-first UI with TailwindCSS
- 🐳 **Docker** - Single container deployment
- 🗄️ **SQLite** - Lightweight, file-based database
- 🔐 **Session Management** - Basic auth with session tokens

## 📋 Tech Stack

### Frontend
- React 18 + Vite
- React Router for navigation
- Socket.io Client for real-time updates
- TailwindCSS for styling
- PWA with Service Worker

### Backend
- Express.js
- Socket.io for WebSocket
- SQLite3
- Node.js 18+

### Infrastructure
- Docker & Docker Compose
- Single container deployment
- Environment-based configuration

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Build the image
docker build -t scorecard-app .

# Run the container
docker run -p 5000:5000 scorecard-app
```

Open http://localhost:5000 in your browser.

### Local Development

#### Prerequisites
- Node.js 18+
- npm or yarn

#### Setup Backend

```bash
cd backend
npm install
npm run init-db  # Initialize SQLite database
npm run dev      # Start development server (port 5000)
```

#### Setup Frontend (in another terminal)

```bash
cd frontend
npm install
npm run dev      # Start dev server (port 5173)
```

Backend API will be proxied to `http://localhost:5000`

#### Using Docker Compose (Development)

```bash
# Start all services with development profiles
docker-compose --profile dev up

# Backend: http://localhost:5001
# Frontend: http://localhost:5173
```

## 🏗️ Project Structure

```
scorecard-claude/
├── backend/
│   ├── src/
│   │   ├── server.js              # Express + Socket.io server
│   │   ├── models/
│   │   │   └── database.js        # SQLite interface
│   │   ├── controllers/
│   │   │   ├── gameController.js  # Game logic
│   │   │   └── scoreController.js # Score logic
│   │   ├── routes/
│   │   │   ├── games.js           # Game endpoints
│   │   │   └── scores.js          # Score endpoints
│   │   └── middleware/
│   │       └── auth.js            # Auth & validation
│   ├── database/
│   │   ├── schema.sql             # Database schema
│   │   └── init.js                # Database initialization
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx                # Main app component
│   │   ├── main.jsx               # Entry point
│   │   ├── components/
│   │   │   └── Navigation.jsx     # Bottom nav
│   │   ├── pages/
│   │   │   ├── Home.jsx           # Home/dashboard
│   │   │   ├── CreateGame.jsx     # Create game flow
│   │   │   ├── JoinGame.jsx       # Join game flow
│   │   │   └── GameBoard.jsx      # Game view
│   │   ├── hooks/
│   │   │   ├── useGame.js         # API calls
│   │   │   └── useWebSocket.js    # WebSocket hook
│   │   ├── context/
│   │   │   └── GameContext.jsx    # State management
│   │   └── index.css              # Tailwind styles
│   ├── public/
│   │   ├── index.html             # HTML template
│   │   ├── manifest.json          # PWA manifest
│   │   └── service-worker.js      # Offline support
│   └── package.json
├── Dockerfile                      # Production build
├── Dockerfile.dev-backend         # Dev backend
├── Dockerfile.dev-frontend        # Dev frontend
├── docker-compose.yml             # Compose config
└── PROJECT_PLAN.md               # Detailed planning
```

## 📡 API Endpoints

### Games
- `POST /api/games` - Create a new game
- `POST /api/games/join` - Join existing game
- `GET /api/games` - Get user's games
- `GET /api/games/:gameId` - Get game details
- `GET /api/games/code/:code` - Get game by code
- `PATCH /api/games/:gameId/status` - Update game status (host only)
- `DELETE /api/games/:gameId/players/:playerId` - Remove player (host only)

### Scores
- `POST /api/scores/games/:gameId/players/:playerId/update` - Add/subtract score
- `POST /api/scores/games/:gameId/players/:playerId/set` - Set absolute score
- `GET /api/scores/games/:gameId/players/:playerId/history` - Get score history
- `GET /api/scores/games/:gameId/leaderboard` - Get leaderboard

### WebSocket Events
- `join-game` - Join a game room
- `score-updated` - Score changed
- `player-joined` - New player joined
- `player-left` - Player left
- `game-state-changed` - Game status changed

## 🗄️ Database Schema

### Users
- `id` - Unique identifier
- `username` - Unique username
- `display_name` - Display name
- `avatar_url` - Profile picture URL
- `created_at` - Account creation time

### Games
- `id` - Unique identifier
- `code` - Shareable game code (XXX-0000 format)
- `name` - Game name
- `host_id` - Game host user ID
- `status` - active/paused/finished
- `target_score` - Optional winning score
- `time_limit` - Optional round duration

### Game Players
- `id` - Unique identifier
- `game_id` - Game reference
- `player_id` - Player user reference
- `current_score` - Current score
- `joined_at` - Join timestamp

### Score History
- `id` - Unique identifier
- `game_id` - Game reference
- `player_id` - Player reference
- `previous_score` - Score before change
- `new_score` - Score after change
- `change_amount` - Amount added/subtracted
- `edited_by_id` - User who made the change
- `timestamp` - Change timestamp

## 🎨 Design System

### Colors
- **Primary**: `#FF8C42` (Orange)
- **Primary Light**: `#FFB088`
- **Primary Dark**: `#FF6B1A`
- **Gray Scale**: Full gradient from 50-900

### Components
- Rounded corners: `1.5rem` to `2rem`
- Card shadows with hover effect
- Orange accent buttons
- Pill-shaped inputs and controls
- Bottom navigation bar

### Responsive
- Mobile-first design
- Max width: `42rem` for content
- Touch-friendly spacing
- Safe areas for notches

## 🔒 Authentication

Currently uses simple session-based authentication:
- User ID stored in localStorage
- Session token in request headers
- Passed in `x-user-id` and `x-session-token` headers

Future: Consider JWT tokens or OAuth for production.

## 📦 Deployment

### Docker Production
```bash
# Build
docker build -t scorecard-app .

# Run
docker run -d \
  -p 5000:5000 \
  -e NODE_ENV=production \
  -v /data/scorecard:/app/database \
  scorecard-app
```

### Environment Variables
```
NODE_ENV=production
PORT=5000
FRONTEND_URL=http://yourdomain.com
```

## 🧪 Testing

Run tests for each component:

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## 🐛 Known Issues

- [ ] Add more comprehensive error handling
- [ ] Implement user authentication
- [ ] Add image upload for profiles
- [ ] Implement game history/analytics
- [ ] Add sound effects/notifications
- [ ] Mobile app version (React Native)

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## 📝 License

MIT License - feel free to use for personal or commercial projects.

## 💡 Future Enhancements

- Real authentication system
- User profiles and avatars
- Game history and statistics
- Leaderboards and achievements
- Multiplayer game templates
- Customizable themes
- Mobile app (React Native)
- Analytics dashboard
- API rate limiting
- Database backups

## 📞 Support

For issues or feature requests, open an issue in the repository.

---

**Built with ❤️ for game nights everywhere** 🎮
