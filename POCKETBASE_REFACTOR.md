# Refactoring Scorekeeper onto PocketBase

This is an analysis of replacing the current Express + `ws` + hand-rolled
SQLite backend (`backend/`) with [PocketBase](https://pocketbase.io) — a
single Go binary that bundles SQLite, a REST+realtime API, an auth system,
an admin UI, and a JS/Go hook layer for custom logic. It follows the same
format as `PORTING.md` (the Cloudflare port analysis): what maps cleanly,
what doesn't, and a phased plan. **Auth is the part the ask specifically
calls out, so it gets the most detail below.**

Bottom line up front: PocketBase is a strong fit for the CRUD and account
surface of this app (games, players, profile, password reset, OAuth if
ever wanted) and would delete most of `backend/src/models/database.js`,
`routes/`, `controllers/`, and `lib/`. It is a **poor fit as-is** for two
things this app currently depends on: atomic relative score deltas
(`+N`/`-N`, not "set field to X") and the debounced, versioned WebSocket
patch protocol in `realtime/gameHub.js`. Both are solvable, but only via
PocketBase's custom-hook escape hatch, not its default record CRUD/realtime
behavior — see [What doesn't map cleanly](#what-doesnt-map-cleanly).

---

## What PocketBase replaces

| Current (this repo) | PocketBase |
| --- | --- |
| `express` app, `routes/`, `controllers/` | PocketBase's built-in REST CRUD per collection, generated from your schema |
| `backend/src/models/database.js` (hand-written SQL) | PocketBase's `dao`/query builder over its own embedded SQLite |
| `backend/database/schema.sql` + `_migrate()` | PocketBase collections, defined in the Admin UI or migration files (`migrations/*.js`), versioned like the rest of the schema |
| `lib/password.js`, `lib/token.js`, custom `users` table | PocketBase's built-in **auth collection** (`authWithPassword`, hashing, token issuance) |
| `lib/email.js` + `/api/auth/forgot-password` / `/reset-password` | PocketBase's built-in `requestPasswordReset` / `confirmPasswordReset` (needs an SMTP config, same as today's `lib/email.js`) |
| `middleware/auth.js` | PocketBase's request-scoped `@request.auth.id`, checked declaratively in **API Rules** per collection, not a shared Express middleware |
| `ws` `WebSocketServer` + `realtime/gameHub.js` | PocketBase's built-in **realtime subscriptions** (SSE, `pb.collection(...).subscribe(...)`) — see caveats below |
| Docker multi-stage Node build | One static binary + `pb_data/` volume; still containerizable but far smaller |
| Admin/debug: nothing today | Free Admin UI (`/_/`) for inspecting games/scores/users without writing SQL |

---

## Auth: current design vs. PocketBase

### Current design (`backend/src/routes/auth.js`, `lib/password.js`, `lib/token.js`)

- Custom `users` table, `email` as the unique login identifier.
- Password: scrypt, self-describing stored string (`scrypt$N$r$p$salt$hash`),
  8–128 chars with letter+digit+special complexity rule.
- Session: one **opaque random token per login**, shown once, only its
  SHA-256 hash stored (`session_token` column). **One active session per
  user** — logging in anywhere rotates the token and force-closes that
  user's open WebSockets (`hub.closeSocketsForUser`). Logout clears it the
  same way.
- Timing-safe login: a precomputed dummy hash is awaited on an
  unknown-email login so the response time doesn't leak whether the email
  is registered.
- Password reset: emailed one-time token (hashed at rest, 30 min TTL),
  `POST /reset-password` also nukes the session token (reset ⇒ logout
  everywhere).
- "Claim password": a session-token-authenticated account with no password
  yet (`password_hash IS NULL`) can set one — used for pre-password legacy
  rows and, implicitly, the door that would exist for any account type that
  starts without a password.
- Guests: typed-in player names get a synthetic `guest:<uuid>` "email" and
  no password — provably unreachable by real login, never appear in any
  auth flow.

### PocketBase's model

- A built-in **auth collection** (call it `users`) gives you
  `pb.collection('users').authWithPassword(email, password)`,
  `authRefresh()`, `requestPasswordReset(email)` /
  `confirmPasswordReset(token, pw, pwConfirm)`, `requestVerification`, and
  optional OAuth2 providers — all with server-side hashing (bcrypt) and
  email delivery already wired to SMTP settings you configure once.
- Tokens are **stateless JWTs** signed with a per-record `tokenKey`, not
  rows in a session table. A JWT stays valid until it expires (config
  default: a few days, refreshable) *regardless of "logout"* — client-side
  `pb.authStore.clear()` only forgets the token locally. The one way to
  invalidate outstanding tokens server-side is to change that record's
  `tokenKey`, which PocketBase does automatically on password
  change/reset, but **not on plain login**.
- Login failure responses are generic 400s already, so the enumeration
  concern is mostly handled by default; the specific constant-time dummy-hash
  trick this repo uses is PocketBase-internal and not something you control.
- Password rules default to a minimum length only; the
  letter+digit+special complexity check has no built-in equivalent.

### Gaps this creates, and how to close them

1. **"One active session, force-logout on login elsewhere."** This has no
   default PocketBase equivalent (JWTs are stateless by design). Closing it
   requires an `onRecordAuthRequest` hook (JS in `pb_hooks/`, or Go) that
   rotates the user's `tokenKey` right after a successful login, which
   invalidates every JWT issued before that moment — same effect as today's
   token rotation, just via a hook instead of the route itself. There is no
   way to also proactively drop that user's *currently open* realtime
   subscriptions the way `closeSocketsForUser` terminates live WebSockets
   today — a still-open SSE connection keeps streaming until it naturally
   reconnects and its refresh fails. Acceptable in practice (a stale tab
   stops being able to *write*, since REST calls re-check the JWT and would
   401 after `tokenKey` rotation, and the score-mutation route below should
   explicitly re-verify), but it's a behavior change worth calling out.
2. **Password complexity rule.** Add an `onRecordBeforeCreateRequest` /
   `onRecordBeforeUpdateRequest` hook on the `users` collection that
   re-implements `passwordComplexityError` and rejects the request before
   PocketBase hashes it.
3. **Guest ("typed-in") players.** Don't put these in the auth collection —
   PocketBase auth collections require a unique, real-shaped email, so the
   `guest:<uuid>` trick doesn't transfer cleanly (and shouldn't; it was a
   workaround for reusing one `users` table for two concepts). Model guests
   as plain rows in a separate, non-auth `players` collection instead:
   `{ id, display_name, is_guest: true }`, with `game_players.player_ref`
   pointing at either a `users` record or a `players` record. This is
   actually a cleanup over today's schema, not a compromise.
4. **"Claim password" for passwordless legacy rows.** This flow exists
   specifically to migrate accounts created before password auth existed.
   On a fresh PocketBase schema there's no such history, so this flow (and
   the `hasPassword` field) simply doesn't need to exist — one less thing
   to port.
5. **What you gain for free:** OAuth2 sign-in (Google/GitHub/etc.) becomes
   a checkbox in the Admin UI plus a frontend button, if ever wanted — no
   equivalent exists today.

---

## What doesn't map cleanly

### Atomic relative score changes

Every score edit today is `changeAmount` (`+5`, `-3`, ...), applied via
`db.changePlayerScore`: read `current_score`, guard non-negative, write the
new value, insert a `score_history` row — one atomic unit, with
`client_op_id` making a replayed offline-queue write idempotent
(`INSERT OR IGNORE` keyed on it, see `scoreService.js` / `gameHub.js`).

PocketBase's default record API is **field replacement**: a client PATCH
sets `current_score` to a value it already knows, which is exactly the
lost-update race this app's current design avoids by keeping the increment
computation and the write in the same DB round-trip. There is no
"increment this field by N" verb in the default REST API.

**This has to become a custom API route**, registered via a hook
(`onBeforeServe`/`app.onServe` in `pb_hooks/main.pb.js`, or a small Go
`main.go` if you'd rather compile than use the JS hook engine). The route:

- takes `{ gameId, playerId, changeAmount, clientOpId }`,
- runs inside `$app.runInTransaction` (or Go `dao.RunInTransaction`),
- re-checks `game.status === 'active'` and host-or-self authorization
  itself (API Rules alone can't express "field X's *new* value depends on
  its *old* value plus a request parameter"),
- upserts `score_history` with a unique index on `client_op_id` for replay
  safety, same as today.

In other words: `applyScoreChange`/`applyScoreSet` in `scoreService.js`
port almost line-for-line into this hook — PocketBase doesn't remove that
code, it just moves where it lives (from an Express controller into a
PocketBase custom route). The **win** is everything *around* it (auth
plumbing, the games/players CRUD, password reset) disappearing; the
**non-win** is that the one piece of business logic this app actually
cares about getting right is exactly the piece PocketBase doesn't give you
off the shelf.

### The realtime protocol

`realtime/gameHub.js` implements a specific contract (documented in
`PORTING.md`'s [Wire protocol](./PORTING.md#wire-protocol) section):
versioned frames, `game:state` (full) vs. `game:patch` (delta), a
leading-edge 200 ms debounce that batches a burst of rapid taps into one
patch, `resync` on a version gap, and per-request `ack`/`error` replies
correlated by `reqId`.

PocketBase's realtime is **per-record, per-collection SSE**: subscribing to
a collection (optionally filtered) gets you a raw stream of
`create`/`update`/`delete` events for individual records, with no
batching, no version counter, and no request/response correlation — it's
a much lower-level primitive than `GameHub`'s frame protocol.

Porting options, in order of how much of the current frontend survives:

1. **Keep the frontend contract, synthesize it server-side.** The custom
   score-change route above also does the debouncing/batching/versioning
   in-process (much like `GameHub` today) and pushes frames over
   PocketBase's realtime as records in a purpose-built `game_frames`
   collection (one row per game, overwritten each broadcast, subscribed by
   `gameId`). This keeps `frontend/src/hooks/useWebSocket.js` and the
   `game:state`/`game:patch` client logic almost unchanged, but it's
   layering a bespoke protocol on top of PocketBase's realtime rather than
   using it as intended — you're back to writing (and hosting inside
   PocketBase's hook runtime) most of `GameHub`.
2. **Adopt PocketBase's model directly.** Subscribe to `game_players`
   (filtered by `game_id`) and `score_history` (same filter, `create`
   events only) and let the client reconstruct roster/score state from raw
   record events, dropping `version`/`resync`/patch-batching entirely. This
   is a real rewrite of `useWebSocket.js`, `GameContext.jsx`, and the ack
   flow (PocketBase subscriptions don't correlate to the request that
   caused them, so "did *my* tap succeed" has to come from the custom
   route's HTTP response instead of a WS `ack`, which is actually simpler
   for that part). Debouncing a rapid-tap burst into one UI update becomes
   a client-side concern (a `requestAnimationFrame`/`setTimeout` coalesce
   in the subscription callback) instead of a server one.

(2) is the more idiomatic PocketBase design and less code overall; (1)
minimizes frontend churn at the cost of re-implementing a bespoke protocol
inside PocketBase's hook sandbox, which mostly defeats the point of
switching. **Recommendation: (2)**, and treat the frontend rewrite of the
realtime hook as the largest single piece of this migration.

### The JS hook runtime is sandboxed

If you go the `pb_hooks/*.pb.js` route instead of a compiled Go extension:
it's a `goja`-based JS engine (ES2020-ish), **not Node** — no `npm`
packages, no `require()` of arbitrary libraries, only what PocketBase's
`$app`/`$os`/etc. globals expose. The score-mutation transaction and the
auth hooks above are simple enough to fit comfortably in that sandbox, but
don't plan on porting anything from `backend/src/lib/` that pulls in an
npm dependency. If more complex server logic accumulates later, compiling
a small Go binary that imports `pocketbase` as a framework (its documented
"use as a Go library" mode) is the escape hatch — same schema/data, real
Go, no sandbox limits.

---

## Schema mapping

| Current table | PocketBase collection | Notes |
| --- | --- | --- |
| `users` | `users` (auth collection) | Drop `password_hash`/`session_token`/`reset_token_*` columns — PocketBase manages these internally. Keep `display_name`, `avatar_url` as regular fields. |
| *(guest players, currently rows in `users`)* | `players` (new, non-auth base collection) | `{ display_name }`. No login, no email requirement. |
| `games` | `games` | `host_id` → relation field to `users`; API Rule `@request.auth.id = host_id` gates status changes/deletion. Cascade-delete configured on the relation, same as today's `ON DELETE CASCADE`. |
| `game_players` | `game_players` | Two relation fields (`user` → `users`, nullable; `guest` → `players`, nullable) instead of one polymorphic `player_id`, since PocketBase relations are typed per-collection. `display_name_override`, `current_score` stay as-is. |
| `score_history` | `score_history` | Unique index on `client_op_id` (nullable, same idempotency purpose). Writes only ever happen through the custom score route, never direct client PATCH — enforce with `createRule: null` (server/hook-only) or a rule that always evaluates false for direct API access, and have the hook write via `$app.dao()` which bypasses rules. |

API Rules replace `middleware/auth.js` + the per-controller checks for
everything that *is* expressible as a filter — e.g. `game_players`
`deleteRule`: `@request.auth.id = game_id.host_id`. The one thing rules
categorically can't do is "compute a new field value from the old one",
which is exactly why the score route above has to exist outside the rules
system.

---

## Frontend changes

- Replace `frontend/src/lib/apiClient.js` (axios + manual bearer header +
  401 interceptor) with the `pocketbase` JS SDK: `new PocketBase(url)`,
  `pb.authStore` auto-persists to `localStorage` and auto-attaches the
  token to every request; `pb.authStore.onChange` replaces the axios 401
  interceptor's "bounce to login" logic.
- `useWebSocket.js` gets rewritten around `pb.collection(...).subscribe()`
  per the realtime section above — this is the biggest single frontend
  change.
- `AuthForm.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx` swap their
  `api.post('/auth/...')` calls for `pb.collection('users').authWithPassword`
  / `requestPasswordReset` / `confirmPasswordReset`.
- `offlineSync.js`'s queue/outbox logic (the localStorage-backed replay
  queue, `client_op_id` idempotency, game/player id remapping) stays
  conceptually unchanged — it's transport-agnostic — but its two mutation
  calls (`create-game`, `score-change`) point at the PocketBase SDK /
  custom route instead of Express endpoints, and `emitScoreChange`'s
  "timed out" vs. "rejected" distinction now comes from an HTTP call
  (timeout vs. 4xx) rather than a WS ack, which is simpler.

---

## Phased plan

1. **Stand up PocketBase locally.** Download the binary, define the
   collections above via the Admin UI (or write them as a migration file
   for reproducibility — PocketBase migrations are just JS files it runs
   on boot).
2. **Auth hooks.** Password-complexity hook, `tokenKey`-rotation-on-login
   hook (single active session). Prove login/register/reset against the
   existing frontend forms with only the API base URL swapped.
3. **Score-mutation route.** Port `scoreService.js`'s logic into a
   PocketBase custom route with a real DB transaction and the
   `client_op_id` unique index. This is the highest-risk piece — write
   focused tests for it before touching anything else (concurrent
   increments, negative-score rejection, replay of the same `client_op_id`).
4. **CRUD surface.** Games/players create/join/status/remove via
   collections + API Rules; this is the part that shrinks the most (most
   of `gameController.js` becomes rule expressions).
5. **Realtime rewrite.** New `useWebSocket.js` (really "useRealtime" at
   this point) subscribing to `game_players`/`score_history`; update
   `GameContext.jsx` to build state from record events instead of
   `game:state`/`game:patch` frames.
6. **Frontend auth pages** → PocketBase SDK calls.
7. **`tests/api` rewrite** — same shape as the Cloudflare port's step 5,
   but against PocketBase's REST API instead of a Workers `SELF` fetch.
8. **`tests/e2e`** (Playwright) against the real thing end-to-end.
9. **Deployment.** Single binary + `pb_data/` volume; update
   `Dockerfile`/`docker-compose.yml` accordingly — this collapses
   substantially versus the current Node multi-stage build.

Rough effort: steps 1–2 (auth) ~1 day; step 3 (score atomicity) ~1–2 days
including tests, since it's the one place correctness bugs would be
expensive; step 4 (CRUD/rules) ~1 day; step 5 (realtime rewrite) ~2–3 days,
the largest frontend chunk; steps 6–9 ~1–2 days. **Call it 6–9 days**,
similar order of magnitude to the Cloudflare port estimate in `PORTING.md`,
weighted toward the realtime rewrite and score-route correctness rather
than infrastructure plumbing.

---

## Recommendation

If the goal is "delete the custom auth/session code and get a real admin
UI, OAuth-if-ever-wanted, and a much smaller deployable" — PocketBase is a
good trade. Budget the migration as **two** pieces of real engineering work
inside an otherwise mostly-declarative rewrite: the atomic score-mutation
route (correctness-critical, needs its own tests) and the realtime hook
rewrite (the largest frontend change). Everything else — users, games,
players, password reset, host/member authorization — maps onto
PocketBase's auth collection + API Rules with little custom code, which is
the majority of what today's `backend/` contains by line count.
