const express = require('express');
const { auth } = require('../middleware/auth');
const { newSessionToken, hashToken } = require('../lib/token');
const { hashPassword, verifyPassword } = require('../lib/password');
const { publicUser } = require('../lib/publicUser');

// Precomputed once at startup (not per-request) and awaited when a login
// targets a username that doesn't exist, so verifyPassword still runs a full
// scrypt either way — otherwise an unknown-username response returns
// measurably faster than a wrong-password one, defeating the point of the
// identical 401 body below.
const dummyHashPromise = hashPassword('not-a-real-password-used-only-for-timing');

module.exports = (db, hub, authLimiter) => {
  const router = express.Router();
  const authed = auth(db);

  // Verify + rotate the session token. One session per user (see
  // schema/README): this invalidates whatever token the account was
  // previously using, and closes any of its currently-open WebSockets so an
  // old, now-logged-out device can't keep writing scores.
  router.post('/login', authLimiter, async (req, res) => {
    try {
      const username = (req.body.username || '').trim();
      const password = req.body.password || '';

      const user = username ? await db.getUserByUsername(username) : null;
      const ok = await verifyPassword(password, user ? user.password_hash : await dummyHashPromise);

      // Same body whether the username doesn't exist, the account has no
      // password set yet, or the password is wrong — don't let a client
      // learn which usernames are registered.
      if (!user || !ok) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = newSessionToken();
      await db.setUserSessionToken(user.id, hashToken(token));
      hub.closeSocketsForUser(user.id);

      res.json({ ...publicUser(user), sessionToken: token });
    } catch (error) {
      console.error('Login failed:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // Clears this user's session token so it can no longer authenticate
  // anywhere, REST or WS.
  router.post('/logout', authed, async (req, res) => {
    try {
      await db.setUserSessionToken(req.userId, null);
      hub.closeSocketsForUser(req.userId);
      res.json({ ok: true });
    } catch (error) {
      console.error('Logout failed:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // Lets a pre-password (legacy) account set one, authenticated by its
  // still-valid existing session token rather than by a password it doesn't
  // have yet.
  router.post('/claim', authed, authLimiter, async (req, res) => {
    try {
      const password = req.body.password || '';
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be 8-128 characters' });
      }

      await db.setUserPassword(req.userId, await hashPassword(password));
      const user = await db.getUserById(req.userId);
      res.json(publicUser(user));
    } catch (error) {
      console.error('Set-password failed:', error);
      res.status(500).json({ error: 'Failed to set password' });
    }
  });

  // The caller's own profile, incl. `hasPassword` so the frontend knows
  // whether to show the "set a password" prompt.
  router.get('/me', authed, (req, res) => {
    res.json(publicUser(req.user));
  });

  return router;
};
