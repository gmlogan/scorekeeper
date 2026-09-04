const express = require('express');
const { auth } = require('../middleware/auth');
const { newSessionToken, hashToken } = require('../lib/token');
const { hashPassword, verifyPassword, passwordComplexityError } = require('../lib/password');
const { publicUser } = require('../lib/publicUser');
const { sendPasswordResetEmail } = require('../lib/email');

// Reset links are only valid for this long after being requested.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

// Precomputed once at startup (not per-request) and awaited when a login
// targets an email that doesn't exist, so verifyPassword still runs a full
// scrypt either way — otherwise an unknown-email response returns
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
      const email = (req.body.email || '').trim();
      const password = req.body.password || '';

      const user = email ? await db.getUserByEmail(email) : null;
      const ok = await verifyPassword(password, user ? user.password_hash : await dummyHashPromise);

      // Same body whether the email doesn't exist, the account has no
      // password set yet, or the password is wrong — don't let a client
      // learn which emails are registered.
      if (!user || !ok) {
        return res.status(401).json({ error: 'Invalid email or password' });
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
      const complexityError = passwordComplexityError(password);
      if (complexityError) {
        return res.status(400).json({ error: complexityError });
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

  // Always responds 200 with the same generic body, whether or not the
  // email is registered — same anti-enumeration reasoning as /login.
  router.post('/forgot-password', authLimiter, async (req, res) => {
    try {
      const email = (req.body.email || '').trim();
      const user = email ? await db.getUserByEmail(email) : null;

      if (user) {
        const token = newSessionToken();
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', '');
        await db.setUserResetToken(user.id, hashToken(token), expiresAt);

        const base = process.env.FRONTEND_URL || '';
        const resetUrl = `${base}/reset-password?token=${token}`;
        await sendPasswordResetEmail(user.email, resetUrl);
      }

      res.json({ ok: true });
    } catch (error) {
      console.error('Forgot-password failed:', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  });

  // Consumes a reset token minted by /forgot-password. Also rotates the
  // session token to null — a password reset should log the account out
  // everywhere, same as a normal password change would.
  router.post('/reset-password', authLimiter, async (req, res) => {
    try {
      const token = req.body.token || '';
      const password = req.body.password || '';

      const complexityError = passwordComplexityError(password);
      if (complexityError) {
        return res.status(400).json({ error: complexityError });
      }

      const user = token ? await db.getUserByResetTokenHash(hashToken(token)) : null;
      if (!user) {
        return res.status(400).json({ error: 'Reset link is invalid or has expired' });
      }

      await db.setUserPassword(user.id, await hashPassword(password));
      await db.clearUserResetToken(user.id);
      await db.setUserSessionToken(user.id, null);
      hub.closeSocketsForUser(user.id);

      res.json({ ok: true });
    } catch (error) {
      console.error('Reset-password failed:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  return router;
};
