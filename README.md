# 🎯 Scorekeeper - Real-Time Multiplayer Score Tracking PWA

A modern Progressive Web App for tracking scores in real-time during games and competitions. Built with React, Node.js, and SQLite, deployed via Docker.

## ✨ Features

### For Players
- 🎮 **Join Games** - Enter a shareable game code to join
- 📊 **Track Scores** - Edit your own scores with add/subtract interface
- 📈 **Score History** - View your last 5 score entries (the amounts added/subtracted) to correct mistakes
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
docker build -t scorekeeper .

# Run the container
docker run -p 5000:5000 scorekeeper
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
scorekeeper/
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

## 📦 Deployment (Docker server via GitHub)

This is the full path for deploying to a Linux host that runs Docker, pulling
the code straight from GitHub (`https://github.com/gmlogan/scorekeeper`).

### How it runs

A single container. The multi-stage `Dockerfile` builds the React frontend, then
the Node/Express backend serves **both** the API and the built frontend on one
port (`5000`). The SQLite schema is applied automatically on every start
(`CREATE TABLE IF NOT EXISTS ...`), so there is no separate DB-init step. The
database file is kept on the host via a bind mount so it survives rebuilds.

### 1. Install prerequisites on the host

**Docker Engine + Compose plugin** (Debian/Ubuntu):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"    # log out/in afterwards so `docker` works without sudo
docker compose version             # verify the compose plugin is present
```

**Git**:

```bash
sudo apt-get update && sudo apt-get install -y git      # Debian/Ubuntu
# sudo dnf install -y git                                # Fedora/RHEL
```

### 2. Install the GitHub CLI (`gh`) on the host

`gh` gives the server its own credentials to clone/pull the repo (works for
private repos too) without putting your personal SSH key on the box.

**Debian / Ubuntu** (official GitHub apt repo):

```bash
sudo mkdir -p -m 755 /etc/apt/keyrings
wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt-get update
sudo apt-get install -y gh
```

**Fedora / RHEL / CentOS**:

```bash
sudo dnf install -y 'dnf-command(config-manager)'
sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
sudo dnf install -y gh
```

**Arch**: `sudo pacman -S github-cli`

**Any distro (no root / no package manager)** — grab the static binary:

```bash
GH_VER=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_amd64.tar.gz" -o /tmp/gh.tgz
tar -xzf /tmp/gh.tgz -C /tmp
sudo install "/tmp/gh_${GH_VER}_linux_amd64/bin/gh" /usr/local/bin/gh
gh --version
```

### 3. Authenticate `gh` and wire it into git

```bash
gh auth login          # choose: GitHub.com → HTTPS → "Login with a web browser"
                        #   (or paste a Personal Access Token with `repo` scope on a headless box)
gh auth setup-git      # makes `git` use gh's token as its credential helper
gh auth status         # confirm you're logged in
```

On a headless server, `gh auth login` prints a one-time code and a URL to open on
any other device. Alternatively: `echo "$GITHUB_TOKEN" | gh auth login --with-token`.

### 4. Clone and start

```bash
sudo mkdir -p /opt && cd /opt
gh repo clone gmlogan/scorekeeper        # or: git clone https://github.com/gmlogan/scorekeeper.git
cd scorekeeper

# Point the app at your public URL (used for Socket.IO CORS) and keep the port on localhost
# so your reverse proxy is the only thing exposed to the internet:
#   docker-compose.yml → services.scorekeeper.environment.FRONTEND_URL = https://scores.example.com
#   docker-compose.yml → services.scorekeeper.ports = ["127.0.0.1:5000:5000"]

docker compose up -d --build            # only starts the `scorekeeper` service; dev services are behind `--profile dev`
docker compose logs -f scorekeeper      # expect "Database connected" then "Server running on port 5000"
curl -s localhost:5000/health           # {"status":"ok"}
```

### 5. Reverse proxy + HTTPS

Socket.IO needs WebSocket upgrade headers. **Caddy** (automatic TLS):

```
scores.example.com {
    reverse_proxy 127.0.0.1:5000
}
```

**nginx**:

```nginx
server {
    server_name scores.example.com;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 6. Updating the deployment

```bash
cd /opt/scorekeeper
git pull
docker compose up -d --build
docker image prune -f          # optional: clean up old layers
```

### 7. Data & backups

- The SQLite DB lives on the host at `./backend/database/scorekeeper.db` (bind mount
  from `docker-compose.yml`). It persists across `up`/`down`/`--build`.
- Back up: `cp backend/database/scorekeeper.db backups/scorekeeper-$(date +%F).db`
  (or `sqlite3 backend/database/scorekeeper.db ".backup 'backups/db.sqlite'"` for a
  consistent copy while running).
- Reset everything: `docker compose down && rm backend/database/scorekeeper.db && docker compose up -d`.

### Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `NODE_ENV` | `production` | Set by `docker-compose.yml`. |
| `PORT` | `5000` | Container listen port. |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed origin for Socket.IO CORS. Set to your public URL. |

The frontend is built for **same-origin** (`frontend/.env.production` has empty
`VITE_API_URL` / `VITE_WS_URL`), so it talks to whatever host serves it — no
rebuild needed per domain.

### Caveats

- Single container + single SQLite file: do **not** scale to multiple replicas —
  each would get its own DB and Socket.IO rooms wouldn't be shared.
- Auth is still just a client-set `x-user-id` header (see [Authentication](#-authentication));
  tighten this before relying on owner-only score editing on a public host.

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
