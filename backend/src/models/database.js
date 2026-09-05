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

    if (version < 2) {
      // v2: add password_hash, and re-add UNIQUE on username (now
      // case-insensitively, so "Dad" and "dad" can't be two accounts) —
      // login needs a unique credential. `schema.sql` runs *before*
      // `_migrate()` on every boot, so a bare `CREATE UNIQUE INDEX` here
      // would already be too late: it would fire against un-deduped data on
      // the very first boot after this ships and crash-loop the server.
      // Rebuilding the table (as v1 did) sidesteps that — the constraint
      // only ever lands transactionally, after the de-dupe below.
      await this._exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN TRANSACTION;

        -- De-dupe existing usernames (case-insensitively) before the new
        -- UNIQUE constraint can be enforced. Renames losers by appending
        -- their id — never DELETEs: games / game_players / score_history
        -- all FK to users(id) ON DELETE CASCADE, and a delete here would
        -- silently destroy that user's games and score history. Losing
        -- rows keep insertion order (MIN(rowid)), so the earliest-created
        -- account for a name keeps its original username.
        UPDATE users
           SET username = username || '#' || id
         WHERE rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY lower(username));

        CREATE TABLE users_v2 (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          display_name TEXT,
          avatar_url TEXT,
          password_hash TEXT,
          session_token TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users_v2 (id, username, display_name, avatar_url, password_hash, session_token, created_at, updated_at)
          SELECT id, username, display_name, avatar_url, NULL, session_token, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_v2 RENAME TO users;

        PRAGMA user_version=2;
        COMMIT;
        PRAGMA foreign_keys=ON;
      `);
      console.log('DB migration v2 applied (users.username unique again, password_hash added)');
    }

    if (version < 3) {
      // v3: username -> email. Same column, same COLLATE NOCASE UNIQUE
      // constraint (that's exactly what a unique login identifier needs) —
      // just a rename, not a rebuild. Guest placeholder rows keep their
      // `guest:<uuid>` value, which is never a valid email so it can never
      // collide with a real registration.
      await this._exec('ALTER TABLE users RENAME COLUMN username TO email');
      await this._exec('PRAGMA user_version=3');
      console.log('DB migration v3 applied (users.username renamed to email)');
    }

    if (version < 4) {
      // v4: nullable reset-token columns for the forgot-password flow.
      // Plain ADD COLUMN — no constraint, no rebuild needed.
      await this._exec(`
        ALTER TABLE users ADD COLUMN reset_token_hash TEXT;
        ALTER TABLE users ADD COLUMN reset_token_expires_at DATETIME;
        PRAGMA user_version=4;
      `);
      console.log('DB migration v4 applied (users reset_token columns added)');
    }

    if (version < 5) {
      // v5: per-game display-name override, so a player whose display_name
      // collides with someone already in the same game can use a temporary
      // name scoped to just that game.
      await this._exec(`
        ALTER TABLE game_players ADD COLUMN display_name_override TEXT;
        PRAGMA user_version=5;
      `);
      console.log('DB migration v5 applied (game_players.display_name_override added)');
    }

    if (version < 6) {
      // v6: client_op_id lets an offline-queued score change be replayed
      // safely after reconnecting. SQLite unique indexes treat every NULL as
      // distinct, so normal (non-queued) writes — which pass no op id — are
      // never affected by the constraint.
      await this._exec(`
        ALTER TABLE score_history ADD COLUMN client_op_id TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_score_history_client_op
          ON score_history(game_id, client_op_id);
        PRAGMA user_version=6;
      `);
      console.log('DB migration v6 applied (score_history.client_op_id added)');
    }
  }

  // User operations
  createUser(id, email, displayName, sessionTokenHash = null, passwordHash = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO users (id, email, display_name, session_token, password_hash) VALUES (?, ?, ?, ?, ?)',
        [id, email, displayName, sessionTokenHash, passwordHash],
        (err) => {
          if (err) reject(err);
          else resolve({ id, email, display_name: displayName });
        }
      );
    });
  }

  setUserPassword(userId, passwordHash) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [passwordHash, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  setUserSessionToken(userId, sessionTokenHash) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET session_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [sessionTokenHash, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  setUserResetToken(userId, tokenHash, expiresAt) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [tokenHash, expiresAt, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // Only returns a row while the token is unexpired — an expired token
  // should behave identically to an unknown one to the caller.
  getUserByResetTokenHash(tokenHash) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT * FROM users WHERE reset_token_hash = ? AND reset_token_expires_at > datetime('now')",
        [tokenHash],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  clearUserResetToken(userId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET reset_token_hash = NULL, reset_token_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
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

  getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
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
  addPlayerToGame(gamePlayerId, gameId, playerId, displayNameOverride = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO game_players (id, game_id, player_id, display_name_override, current_score) VALUES (?, ?, ?, ?, 0)',
        [gamePlayerId, gameId, playerId, displayNameOverride],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getGamePlayers(gameId) {
    return new Promise((resolve, reject) => {
      // `u.email` is deliberately excluded: it's a login credential now,
      // and the frontend only ever renders `display_name` — selecting it
      // would broadcast every player's login handle to the whole roster.
      // `display_name` resolves to this game's override when the player
      // joined with a colliding name (see gameController.joinGame).
      this.db.all(
        `SELECT gp.*, COALESCE(gp.display_name_override, u.display_name) AS display_name
         FROM game_players gp
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

  // `clientOpId`, when present, makes this call idempotent: replaying a
  // change with the same id (an offline-queued score change retried after a
  // dropped ack) returns the original result instead of applying it twice.
  // The lookup + apply happen inside the same per-(game,player) serialized
  // mutation so a genuine concurrent retry can't race past the check.
  getScoreHistoryByClientOp(gameId, clientOpId) {
    if (!clientOpId) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM score_history WHERE game_id = ? AND client_op_id = ?',
        [gameId, clientOpId],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });
  }

  scoreResultFromHistoryRow(row) {
    return {
      previousScore: row.previous_score,
      newScore: row.new_score,
      entry: {
        id: row.id,
        change_amount: row.change_amount,
        new_score: row.new_score,
        timestamp: row.timestamp,
      },
    };
  }

  changePlayerScore(gameId, playerId, changeAmount, editedByUserId, clientOpId = null) {
    return this.enqueueScoreMutation(gameId, playerId, () =>
      this.getScoreHistoryByClientOp(gameId, clientOpId).then((existing) => {
        if (existing) return this.scoreResultFromHistoryRow(existing);

        return new Promise((resolve, reject) => {
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
                editedByUserId,
                clientOpId
              ).then(resolve, reject);
            }
          );
        });
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

  updatePlayerScoreNow(gameId, playerId, newScore, changeAmount, editedByUserId, clientOpId = null) {
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
                `INSERT INTO score_history (id, game_id, player_id, previous_score, new_score, change_amount, edited_by_id, client_op_id, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [entryId, gameId, playerId, previousScore, newScore, changeAmount, editedByUserId, clientOpId, timestamp],
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
