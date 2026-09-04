const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// scrypt cost params. N=16384 (2^14), r=8, p=1 costs ~16MB memory
// (128*N*r bytes) per hash — comfortably under Node's default 32MB
// scrypt `maxmem`, and OWASP's baseline recommendation for interactive
// login. Encoded into the stored string so a later param bump doesn't
// break verifying passwords hashed under the old params.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

// A password is never stored — only this derivation, as one
// self-describing string: "scrypt$N$r$p$<salt b64>$<hash b64>".
const hashPassword = async (password) => {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
};

// Constant-time verify. Returns false (never throws) for a null/malformed
// stored value — legacy users have `password_hash IS NULL`, and a
// tampered/foreign format should fail closed, not 500.
const verifyPassword = async (password, stored) => {
  if (typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(keyB64, 'base64');
  } catch (_) {
    return false;
  }

  const actual = await scrypt(String(password), salt, expected.length, { N: n, r, p });
  // timingSafeEqual throws on a length mismatch — compare lengths first so a
  // malformed stored hash fails closed instead of 500ing (which would itself
  // be a side channel distinguishing malformed-hash from wrong-password).
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
};

// Length bound (8-128) plus at least one letter, one digit, and one special
// character. Returns an error string to show the user, or null if the
// password is acceptable — callers just check truthiness.
const passwordComplexityError = (password) => {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Password must be 8-128 characters';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must mix letters, numbers, and special characters';
  }
  return null;
};

module.exports = { hashPassword, verifyPassword, passwordComplexityError };
