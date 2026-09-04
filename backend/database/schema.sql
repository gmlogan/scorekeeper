-- Database schema for Scorekeeper App

-- Users table
-- `email` is the unique (case-insensitive) login identifier. `display_name`
-- is a free-form, non-unique label — two people can both show as "Dad" in
-- a game. `password_hash` is nullable: accounts created before login
-- existed keep working on their existing session token until they set one.
-- Typed-in "guest" players (added by a host, not real accounts) store a
-- synthetic `guest:<uuid>` value here — never a valid email, so it can
-- never collide with or be reachable by a real registration.
-- `reset_token_hash`/`reset_token_expires_at` back the forgot-password flow
-- (see backend/src/routes/auth.js) — nullable, only set while a reset is
-- pending.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  password_hash TEXT,
  session_token TEXT UNIQUE,
  reset_token_hash TEXT,
  reset_token_expires_at DATETIME,
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
-- `display_name_override` lets a player who joins with the same
-- display_name as someone already in this game use a temporary name for
-- just this game, without touching their account's real display_name.
CREATE TABLE IF NOT EXISTS game_players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name_override TEXT,
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
