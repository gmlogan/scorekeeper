-- Database schema for Scorekeeper App

-- Users table
-- `username` is NOT globally unique: identity is the server-issued session
-- token (stored hashed in `session_token`), and the name is just a display
-- label, so two people can both be "Dad" in different games.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  session_token TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Games table
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  host_id TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'finished')),
  target_score INTEGER,
  time_limit INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Game players table
CREATE TABLE IF NOT EXISTS game_players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  current_score INTEGER DEFAULT 0,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(game_id, player_id)
);

-- Score history table
CREATE TABLE IF NOT EXISTS score_history (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  previous_score INTEGER,
  new_score INTEGER NOT NULL,
  change_amount INTEGER NOT NULL,
  edited_by_id TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (edited_by_id) REFERENCES users(id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_games_code ON games(code);
CREATE INDEX IF NOT EXISTS idx_games_host_id ON games(host_id);
CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_player_id ON game_players(player_id);
CREATE INDEX IF NOT EXISTS idx_score_history_game_id ON score_history(game_id);
CREATE INDEX IF NOT EXISTS idx_score_history_player_id ON score_history(player_id);
CREATE INDEX IF NOT EXISTS idx_score_history_timestamp ON score_history(timestamp);
