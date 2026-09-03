const crypto = require('crypto');

// A session token is a 256-bit random secret, minted server-side and shown to
// the client exactly once (in the POST /api/users response). Only its SHA-256
// hash is stored, so a database leak can't be replayed as a live session.
const newSessionToken = () => crypto.randomBytes(32).toString('base64url');

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { newSessionToken, hashToken };
