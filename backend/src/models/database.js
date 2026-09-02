const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '..', '..', 'database', 'scorekeeper.db');
    this.dbDir = path.dirname(this.dbPath);
    this.db = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Ensure directory exists
      if (!fs.existsSync(this.dbDir)) {
        fs.mkdirSync(this.dbDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.db.run('PRAGMA foreign_keys = ON');

        // Apply the schema on every start. Every statement is
        // "CREATE ... IF NOT EXISTS", so this is safe and idempotent.
        const schemaPath = path.join(this.dbDir, 'schema.sql');
        let schema = null;
        try {
          schema = fs.readFileSync(schemaPath, 'utf-8');
        } catch (readErr) {
          console.warn('No schema.sql found, skipping schema init:', readErr.message);
        }

        const done = () => {
          console.log('Connected to database at:', this.dbPath);
          resolve();
        };

        if (schema) {
          this.db.exec(schema, (schemaErr) => {
            if (schemaErr) reject(schemaErr);
            else done();
          });
        } else {
          done();
        }
      });
    });
  }

  // User operations
  createUser(id, username, displayName) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)',
        [id, username, displayName],
        (err) => {
          if (err) reject(err);
          else resolve({ id, username, displayName });
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
    return new Promise((resolve, reject) => {
      // Get current score
      this.db.get(
        'SELECT current_score FROM game_players WHERE game_id = ? AND player_id = ?',
        [gameId, playerId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          const previousScore = row?.current_score || 0;

          // Update score in game_players
          this.db.run(
            'UPDATE game_players SET current_score = ? WHERE game_id = ? AND player_id = ?',
            [newScore, gameId, playerId],
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              // Add to score history
              const { v4: uuidv4 } = require('uuid');
              const historyId = uuidv4();

              this.db.run(
                `INSERT INTO score_history (id, game_id, player_id, previous_score, new_score, change_amount, edited_by_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [historyId, gameId, playerId, previousScore, newScore, changeAmount, editedByUserId],
                (err) => {
                  if (err) reject(err);
                  else resolve({ previousScore, newScore });
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
         ORDER BY timestamp DESC
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
