# 🚀 Quick Start Guide - Scorekeeper

## Option 1: Docker (Easiest - Recommended)

### Prerequisites
- Docker installed
- Port 5000 available

### Run Production Build
```bash
cd scorekeeper

# Build the Docker image
docker build -t scorekeeper .

# Run the container
docker run -p 5000:5000 \
  -v $(pwd)/backend/database:/app/database \
  scorekeeper
```

Then open: **http://localhost:5000**

---

## Option 2: Local Development (Recommended for Development)

### Terminal 1 - Backend
```bash
cd scorekeeper/backend

# Install dependencies
npm install

# Initialize database (first time only)
npm run init-db

# Start development server
npm run dev
```
✅ Backend runs on http://localhost:5000

### Terminal 2 - Frontend
```bash
cd scorekeeper/frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```
✅ Frontend runs on http://localhost:5173

Backend API is proxied from the Vite dev server.

---

## First Time Usage

1. **Enter your name** on the home page
2. **Create a New Scoreboard**:
   - Enter game name (e.g., "Friday Board Games")
   - Add player names
   - Optional: Set target score and time limit
   - Click "Create Scoreboard"
   - Share the game code with others

3. **Join a Game**:
   - Enter the game code (format: ABC-1234)
   - Click "Join Game"

4. **Track Scores**:
   - Click a player to select them
   - Use +1, +5, -1, -5 buttons or enter custom amount
   - Scores update in real-time for all players
   - **Host only**: Can edit any player's score

---

## Key Features

- 🎲 **Create Games** - Set up scoreboard with custom rules
- 👥 **Invite Players** - Share game code (ABC-1234)
- 📊 **Real-Time** - Scores sync instantly via WebSocket
- 📱 **PWA** - Install on phone, works offline
- ⚙️ **Host Controls** - Edit any score, pause/end game

---

## Troubleshooting

### Frontend won't connect to backend
- Check backend is running on port 5000
- Check `frontend/.env.development` has correct API URL

### Database errors
```bash
# Reset database
rm backend/database/scorekeeper.db
npm run init-db  # (from backend directory)
```

### Port already in use
```bash
# Change ports in .env files or use different port
PORT=5001 npm run dev  # Backend
# or
npm run dev -- --port 5174  # Frontend
```

---

## File Structure Overview

```
scorekeeper/
├── backend/              # Express API + WebSocket
│   ├── src/server.js     # Main server
│   └── database/         # SQLite files
├── frontend/             # React PWA
│   ├── src/              # React components
│   └── public/           # Static assets
├── Dockerfile            # Production build
└── docker-compose.yml    # Multi-service setup
```

---

## Next Steps

1. **Test locally** - Run it and create your first game
2. **Install on phone** - Open in mobile browser, click "Install" 
3. **Deploy** - Use Docker to deploy anywhere
4. **Customize** - Edit colors/layout in `frontend/src/index.css` and `tailwind.config.js`

---

## Environment Variables

### Backend (.env)
```
NODE_ENV=production
PORT=5000
FRONTEND_URL=http://localhost
```

### Frontend (.env.development)
```
VITE_API_URL=http://localhost:5000
VITE_WS_URL=http://localhost:5000
```

---

## NPM Commands

### Backend
- `npm run dev` - Start with auto-reload
- `npm start` - Run production server
- `npm run init-db` - Initialize database

### Frontend
- `npm run dev` - Start Vite dev server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

---

**Questions?** Check the full README.md for comprehensive documentation.
