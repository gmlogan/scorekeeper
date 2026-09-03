# Porting Scorekeeper to Cloudflare

This repo (`scorecard-claude`) is the **Node reference implementation**:
Express + `ws` + SQLite, one long-running process. It is frozen at tag
`v1.0-node` and only takes bug fixes from here on.

The plan below freezes this repo cleanly, clones it to a new repo
(`scorecard-cf`), and converts that clone to **Cloudflare Workers + Durable
Objects + D1**. The frontend is carried over almost unchanged — it already
speaks a backend-agnostic wire protocol (see [Wire protocol](#wire-protocol)),
so the same client works against either backend.

Estimated effort: **Phase 0** ½ day · **Phase 1** ½ hour · **Phase 2** 3–5 days.

---

## Phase 0 — Freeze this repo as the Node reference

1. **Commit the pending work.** Everything from the last four refactor passes
   is currently uncommitted. Suggested commit sequence (or squash to one):
   - `feat(realtime): push game state instead of refetch pings`
   - `refactor(realtime): raw WebSocket + in-memory rooms + patch frames`
   - `fix(history): millisecond timestamps, deterministic ordering`
   - `feat(auth): server-issued bearer tokens, verified on REST + WS`
2. **Verify from a clean checkout:** fresh `npm run setup && npm run init &&
   npm test` — 5 API tests + 1 e2e test must pass. This is the known-good
   baseline the port is measured against.
3. **Write `PROTOCOL.md`** from the [Wire protocol](#wire-protocol) section
   below and commit it. It is the contract the Cloudflare port must preserve.
4. **Tag and push:**
   ```bash
   git tag -a v1.0-node -m "Node/Express/ws/sqlite reference implementation"
   git push origin v1.0-node
   ```
5. Freeze. Future changes here are bug-fix only; features go in the new repo.

---

## Phase 1 — Clone to the new repo

```bash
git clone https://github.com/you/scorecard-claude scorecard-cf
cd scorecard-cf
git remote set-url origin https://github.com/you/scorecard-cf
git checkout -b cloudflare-port
git push -u origin cloudflare-port
```

Keeps full history — useful for `git blame` on the frontend and the DB layer.
For a clean slate instead: `rm -rf .git && git init && git commit -m "import
from scorecard-claude @ v1.0-node"`.

**Layout decision:** keep it a monorepo (frontend + worker in one repo). The
frontend barely changes. Split the frontend to Cloudflare Pages later only if
you want an independent deploy cadence.

---

## Phase 2 — Convert to Cloudflare

### Target shape

One Worker that:

- serves the built frontend via **Static Assets** (`env.ASSETS`),
- handles `/api/*` and the `/ws` upgrade,
- routes each game to a **`GameRoom` Durable Object** (one instance per `gameId`),
- persists to **D1**.

### Source → target mapping

| Node (this repo) | Cloudflare (`scorecard-cf`) |
| --- | --- |
| `express` app + routers | Worker `fetch(req, env, ctx)` + small router (`itty-router` or hand-rolled) |
| `http.createServer` + `ws` `WebSocketServer` on `/ws` | Worker handles `Upgrade` on `/ws`, builds the `WebSocketPair`, `stub.fetch()` to the game's DO |
| `GameHub` (in-process `Map` of rooms) | **`GameRoom` DO**, one per `gameId` — `env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId))` |
| `room.sockets` (`Set`) | `this.ctx.getWebSockets()` (Hibernation API) |
| `ws.on('message')` / `ws.on('close')` | `webSocketMessage(ws, msg)` / `webSocketClose(ws, …)` |
| `ws.on('pong')` + `setInterval` heartbeat | `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'))` — no manual interval |
| `room.pending` / `room.timer` (leading-edge debounce) | `ctx.storage.setAlarm(Date.now() + 200)` + an `alarm()` handler that flushes `pending` — or drop the debounce initially |
| `db` (sqlite3, callback API) | `env.DB` (D1) — method bodies port ~1:1, all become `async`; batch `UPDATE` + `INSERT` with `env.DB.batch([...])` |
| `enqueueScoreMutation` (per-player promise chain) | delete it — a DO instance is single-threaded; use `UPDATE … RETURNING` |
| `backend/database/schema.sql` + `_migrate()` (`user_version`) | `migrations/0001_init.sql`, `0002_username_not_unique.sql` via `wrangler d1 migrations` |
| `lib/token.js` (`crypto.randomBytes`, `crypto.createHash`) | Web Crypto: `crypto.getRandomValues` + `await crypto.subtle.digest('SHA-256', …)` |
| `middleware/auth.js` — `auth(db)` middleware | `requireAuth(req, env)` → `{ userId }` or a `Response(401)` |
| REST controllers (`scoreController`, `gameController`) | plain `async (req, env, params) => Response` |
| `hub.reloadAndBroadcast(gameId)` (in-process call) | REST handler does `stub.fetch('https://do/_internal/reload')`; the DO re-hydrates from D1 and re-broadcasts |
| `express.static(publicDir)` + SPA fallback | `env.ASSETS.fetch(req)` with fallback to `index.html` |
| `process.env.*`, `.env` | `wrangler.toml [vars]` + `wrangler secret put` |

### Watch items

**Timers do not survive hibernation.** `setTimeout` only lives inside a single
invocation; a DO can hibernate between messages. The leading-edge debounce
(`queueChange` → `flush` after 200 ms) must move to `ctx.storage.setAlarm()` +
an `alarm()` handler. Simplest first cut: broadcast every change immediately
(a `game:patch` is ~180 B) and add alarm-based batching only if message volume
warrants it.

**WS auth gets cleaner, not harder.** The same subprotocol trick works
(`Sec-WebSocket-Protocol: bearer, <token>`). The Worker verifies the token
against D1 *before* creating the socket, then passes `userId` to the DO via an
internal header — the DO trusts it because the call is internal. This replaces
the `ws.authReady` promise gate in `GameHub.handleConnection`.

**D1 has no synchronous API.** Every `db.*` method becomes `async` with
`await env.DB.prepare(...).bind(...).run()/.all()/.first()`. Callers already
`await`, so they don't change. `env.DB.batch()` runs statements atomically —
use it for the score `UPDATE` + history `INSERT`.

**Hot-state option (for free-tier headroom).** Keep `current_score` + last-5
history in `ctx.storage` (DO-local, its own quota, fast) and flush rollups to
D1 on `alarm()` / game-finish. Do the straight D1 port first; add this only
once it's green.

### Conversion order

Work through these in `scorecard-cf`, keeping tests green as you go.

1. **Scaffold.** `wrangler.toml` with a D1 binding, a `GAME_ROOM` DO binding,
   and `assets`. Worker entry with `/health`. Get `wrangler dev` serving the
   built frontend.
2. **Schema.** Port `schema.sql` and the `_migrate()` step to D1 migration
   files; `wrangler d1 migrations apply --local`.
3. **Primitives.** Port `lib/token.js` to Web Crypto; port `middleware/auth.js`
   to `requireAuth`.
4. **DB layer.** Port `models/database.js` → `src/db.js` (D1, same method
   names, `async`). Drop `_migrate` and `enqueueScoreMutation`.
5. **REST.** Port controllers + routes to router functions: `/api/users`,
   `/api/games/*`, `/api/scores/*`, `/api/users/me`. **Green the API test
   suite** — rewrite `tests/api` for `@cloudflare/vitest-pool-workers`
   (`fetch` against `SELF`, not supertest).
6. **DO.** Build `GameRoom`: `fetch` (WS upgrade + `_internal/reload`),
   `webSocketMessage`, `webSocketClose`, `alarm`. Port `GameHub` logic —
   `hydrate` from D1 inside `blockConcurrencyWhile`, then `frame` / `broadcast`
   / `queueChange` / `flush` / `applyScoreChange` / `onJoin` / `onResync` /
   `onScoreMessage` nearly verbatim.
7. **Wire `/ws`.** Worker verifies the token → `idFromName(gameId)` →
   `stub.fetch(upgradeRequest, { headers: { 'x-user-id': userId } })`.
8. **Wire REST → DO.** Mutations (`joinGame`, status change, remove player,
   REST score writes) call `stub.fetch('/_internal/reload')` so the DO
   re-broadcasts.
9. **e2e.** Run `tests/e2e` (Playwright) with `baseURL` pointed at
   `wrangler dev`. Fix any drift against `PROTOCOL.md`.
10. **Deploy.** `wrangler deploy`; `wrangler secret put` for any secrets;
    smoke-test on `*.workers.dev`.
11. *(optional)* DO-storage hot state + D1 rollups.
12. *(optional)* split the frontend to Cloudflare Pages for independent deploys.

### Repo hygiene in the clone

- **Remove:** `backend/database/`, `backend/src/server.js`,
  `backend/src/models/`.
- **Add:** `wrangler.toml`, `migrations/`, `src/worker.js`, `src/room.js`,
  `src/db.js`, `src/auth.js`, `src/routes/*`.
- **`package.json`:** drop `express`, `ws`, `sqlite3`, `body-parser`, `cors`,
  `dotenv`, `nodemon`. Add `wrangler`, `@cloudflare/workers-types`,
  `@cloudflare/vitest-pool-workers`, and optionally `itty-router`.
- **`frontend/`:** unchanged except `.env.production` can be emptied — when the
  Worker serves the assets, the client talks to its own origin.

### Frontend changes (minimal)

- `useWebSocket.js` `endpoint()` and `useGame.js` `API_URL` already fall back
  to same-origin. If the Worker serves the built assets, **production needs no
  env vars**.
- For a split deploy (frontend on Pages), set `VITE_API_URL` and `VITE_WS_URL`
  to the Worker origin.
- Nothing in the message handling changes — `game:state` / `game:patch` /
  `ack` / `resync` and the version rules are identical.

---

## Wire protocol

The contract shared by both backends. Copy this into `PROTOCOL.md` in Phase 0.

### Auth

- `POST /api/users` with `{ username }` → `201 { id, username, display_name,
  sessionToken }`. The token is shown once; only its SHA-256 hash is stored.
- Every other request authenticates with `Authorization: Bearer <sessionToken>`
  (legacy `x-session-token: <sessionToken>` also accepted).
- `req.userId` / `ws.userId` always come from the verified token row, never
  from a client-supplied id.

### REST surface

| Method + path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/users` | none | Register; mint id + token |
| `PATCH /api/users/me` | yes | Update display name |
| `POST /api/games` | yes | Create game (creator becomes host + player) |
| `POST /api/games/join` | yes | Add the authenticated user to a game by `code` |
| `GET /api/games/:gameId` | none | Game + roster (lookup by unguessable id) |
| `GET /api/games/code/:code` | none | Game + roster by code |
| `GET /api/games` | yes | The caller's games |
| `GET /api/games/hosted` · `DELETE /api/games/hosted` | yes | Games the caller hosts |
| `PATCH /api/games/:gameId/status` | yes (host) | `active` / `paused` / `finished` |
| `DELETE /api/games/:gameId/players/:playerId` | yes (host) | Remove a player |
| `POST /api/scores/games/:gameId/players/:playerId/update` | yes | Relative score change |
| `POST /api/scores/games/:gameId/players/:playerId/set` | yes | Absolute score |
| `GET /api/scores/games/:gameId/players/:playerId/history` | yes | Score history |
| `GET /api/scores/games/:gameId/leaderboard` | yes | Ordered roster |

### WebSocket

- Endpoint: `/ws`. Token carried as the second subprotocol:
  `new WebSocket(url, ['bearer', <sessionToken>])`. The server must echo
  `bearer` or the browser drops the socket.

**Client → server**

| Message | Fields |
| --- | --- |
| `join` | `{ gameId }` |
| `leave` | `{ gameId }` |
| `resync` | `{ gameId }` |
| `score:change` | `{ gameId, playerId, changeAmount, reqId }` |

**Server → client**

| Message | Fields |
| --- | --- |
| `game:state` | `{ version, game, players, history }` — full authoritative frame |
| `game:patch` | `{ version, changes: [{ playerId, newScore, entry }] }` |
| `ack` | `{ reqId, ok, playerId?, previousScore?, newScore?, error? }` |
| `error` | `{ message }` |

`entry` = `{ id, change_amount, new_score, timestamp }`.
`history` = `{ [playerId]: entry[] }`, newest first, last 5.

### Versioning rules

- `version` is a monotonic integer per game, held in memory (the room / DO),
  incremented once per emitted frame (patch batch or full frame).
- Client applies a **full frame** if `version >= lastApplied`, then sets
  `lastApplied = version`.
- Client applies a **patch** only if `version === lastApplied + 1`; on a gap it
  sends `resync` and the server replies with a `game:state`.
- On (re)connect the client resets `lastApplied = 0` and re-sends `join`; the
  server responds with a fresh full frame.

### Realtime behaviour

- `join` broadcasts one full `game:state` to the whole room (roster refresh for
  everyone).
- `score:change` writes through to the DB, updates in-memory state from the
  authoritative result, then queues a `game:patch`.
- Patches use a leading-edge debounce (~200 ms): first change emits
  immediately, a trailing burst coalesces into one more batched patch.
- REST mutations (status, roster, REST score writes) trigger a full
  `game:state` re-broadcast.
- Heartbeat: `ping` / `pong` every ~90 s; dead sockets are terminated.
