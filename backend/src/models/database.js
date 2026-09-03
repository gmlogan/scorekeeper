const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '..', '..', 'database', 'scorekeeper.db');
    this.dbDir = path.dirname(this.dbPath);
    this.db = null;
    this.scoreQueues = new Map();
  }

  _exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => (err ? reject(err) : resolve()));
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.dbDir)) {
        fs.mkdirSync(this.dbDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) return reject(err);

        try {
          await this._exec('PRAGMA foreign_keys = ON');

          // Schema statements are all "CREATE ... IF NOT EXISTS" — safe to run
          // on every start.
          const schemaPath = path.join(this.dbDir, 'schema.sql');
          if (fs.existsSync(schemaPath)) {
            await this._exec(fs.readFileSync(schemaPath, 'utf-8'));
          } else {
            console.warn('No schema.sql found, skipping schema init');
          }

          await this._migrate();

          console.log('Connected to database at:', this.dbPath);
          resolve();
        } catch (initErr) {
          reject(initErr);
        }
      });
    });
  }

  // Forward-only migrations, gated by PRAGMA user_version.
  async _migrate() {
    const row = await this._get('PRAGMA user_version');
    const version = row ? row.user_version : 0;

    if (version < 1) {
      // v1: drop the global UNIQUE constraint on users.username. Identity is
      // the session token now; the name is only a label. SQLite can't drop a
      // column constraint in place, so rebuild the table.
      await this._exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN TRANSACTION;
        CREATE TABLE IF NOT EXISTS users_v1 (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          display_name TEXT,
          avatar_url TEXT,
          session_token TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users_v1 (id, username, display_name, avatar_url, session_token, created_at, updated_at)
          SELECT id, username, display_name, avatar_url, session_token, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_v1 RENAME TO users;
        COMMIT;
        PRAGMA foreign_keys=ON;
        PRAGMA user_version=1;
      `);
      console.log('DB migration v1 applied (users.username no longer unique)');
    }
  }

  // User operations
  createUser(id, username, displayName, sessionTokenHash = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO users (id, username, display_name, session_token) VALUES (?, ?, ?, ?)',
        [id, username, displayName, sessionTokenHash],
        (err) => {
          if (err) reject(err);
          else resolve({ id, username, display_name: displayName });
        }
      );
    });
  }

  getUserBySessionToken(sessionTokenHash) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE session_token = ?',
        [sessionTokenHash],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  getUserById(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE id = ?',
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  getUserByUsername(username) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE username = ?',
        [username],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  updateUserDisplayName(userId, displayName) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [displayName, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // Game operations
  createGame(id, code, name, hostId, targetScore = null, timeLimit = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO games (id, code, name, host_id, target_score, time_limit) VALUES (?, ?, ?, ?, ?, ?)',
        [id, code, name, hostId, targetScore, timeLimit],
        (err) => {
          if (err) reject(err);
          else resolve({ id, code, name, hostId, targetScore, timeLimit });
        }
      );
    });
  }

  getGameByCode(code) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM games WHERE code = ?',
        [code],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  getGameById(gameId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM games WHERE id = ?',
        [gameId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  getGamesByUserId(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT g.* FROM games g
         LEFT JOIN game_players gp ON g.id = gp.game_id
         WHERE g.host_id = ? OR gp.player_id = ?
         ORDER BY g.updated_at DESC`,
        [userId, userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  getGamesByHostId(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM games WHERE host_id = ? ORDER BY created_at DESC',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  deleteGamesByHostId(userId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM games WHERE host_id = ?',
        [userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  updateGameStatus(gameId, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, gameId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Game player operations
  addPlayerToGame(gamePlayerId, gameId, playerId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO game_players (id, game_id, player_id, current_score) VALUES (?, ?, ?, 0)',
        [gamePlayerId, gameId, playerId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getGamePlayers(gameId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT gp.*, u.username, u.display_name FROM game_players gp
         JOIN users u ON gp.player_id = u.id
         WHERE gp.game_id = ?
         ORDER BY gp.current_score DESC`,
        [gameId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  removePlayerFromGame(gameId, playerId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM game_players WHERE game_id = ? AND player_id = ?',
        [gameId, playerId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Score operations
  updatePlayerScore(gameId, playerId, newScore, changeAmount, editedByUserId) {
    return this.enqueueScoreMutation(gameId, playerId, () =>
      this.updatePlayerScoreNow(gameId, playerId, newScore, changeAmount, editedByUserId)
    );
  }

  changePlayerScore(gameId, playerId, changeAmount, editedByUserId) {
    return this.enqueueScoreMutation(gameId, playerId, () =>
      new Promise((resolve, reject) => {
        this.db.get(
          'SELECT current_score FROM game_players WHERE game_id = ? AND player_id = ?',
          [gameId, playerId],
          (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Player not in game'));

            const newScore = row.current_score + changeAmount;
            if (newScore < 0) return reject(new Error('Score cannot be negative'));

            this.updatePlayerScoreNow(
              gameId,
              playerId,
              newScore,
              changeAmount,
              editedByUserId
            ).then(resolve, reject);
          }
        );
      })
    );
  }

  setPlayerScore(gameId, playerId, newScore, editedByUserId) {
    return this.enqueueScoreMutation(gameId, playerId, () =>
      new Promise((resolve, reject) => {
        this.db.get(
          'SELECT current_score FROM game_players WHERE game_id = ? AND player_id = ?',
          [gameId, playerId],
          (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Player not in game'));
            this.updatePlayerScoreNow(
              gameId,
              playerId,
              newScore,
              newScore - row.current_score,
              editedByUserId
            ).then(resolve, reject);
          }
        );
      })
    );
  }

  enqueueScoreMutation(gameId, playerId, mutation) {
    const key = `${gameId}:${playerId}`;
    const previous = this.scoreQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(mutation);
    const cleanup = current.then(() => {
      if (this.scoreQueues.get(key) === cleanup) this.scoreQueues.delete(key);
    }, () => {
      if (this.scoreQueues.get(key) === cleanup) this.scoreQueues.delete(key);
    });
    this.scoreQueues.set(key, cleanup);
    return current;
  }

  updatePlayerScoreNow(gameId, playerId, newScore, changeAmount, editedByUserId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT current_score FROM game_players WHERE game_id = ? AND player_id = ?',
        [gameId, playerId],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return reject(new Error('Player not in game'));

          const previousScore = row.current_score;
          this.db.run(
            'UPDATE game_players SET current_score = ? WHERE game_id = ? AND player_id = ?',
            [newScore, gameId, playerId],
            (updateErr) => {
              if (updateErr) return reject(updateErr);

              // Millisecond-precision UTC timestamp in the same shape as
              // CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS.mmm"), generated here
              // so the stored value and the value we hand back to the
              // in-memory room are identical and entries made in the same
              // second still sort in the order they happened.
              const entryId = uuidv4();
              const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
              this.db.run(
                `INSERT INTO score_history (id, game_id, player_id, previous_score, new_score, change_amount, edited_by_id, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [entryId, gameId, playerId, previousScore, newScore, changeAmount, editedByUserId, timestamp],
                (historyErr) => {
                  if (historyErr) reject(historyErr);
                  else resolve({
                    previousScore,
                    newScore,
                    entry: {
                      id: entryId,
                      change_amount: changeAmount,
                      new_score: newScore,
                      timestamp,
                    },
                  });
                }
              );
            }
          );
        }
      );
    });
  }

  getScoreHistory(gameId, playerId, limit = 3) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM score_history
         WHERE game_id = ? AND player_id = ?
         ORDER BY timestamp DESC, rowid DESC
         LIMIT ?`,
        [gameId, playerId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = Database;
