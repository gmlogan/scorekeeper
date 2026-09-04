import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, db } from '../../backend/src/server.js';
import Database from '../../backend/src/models/database.js';
import { newSessionToken, hashToken } from '../../backend/src/lib/token.js';
import { randomUUID as uuidv4 } from 'crypto';

const uniqueEmail = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;

// Satisfies the complexity rule (letter + digit + special char) so tests
// that expect registration/login to succeed don't trip on an unrelated
// weak-password rejection.
const GOOD_PASSWORD = 'correct-horse-1!';

describe('auth API', () => {
  beforeAll(async () => {
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
  });

  it('registers, logs in, and rejects the wrong password with the same body as an unknown email', async () => {
    const email = uniqueEmail('auth-user');
    const password = GOOD_PASSWORD;

    const register = await request(app).post('/api/users').send({ email, password });
    expect(register.status).toBe(201);
    expect(register.body.sessionToken).toBeTruthy();
    expect(register.body).not.toHaveProperty('password');
    expect(register.body).not.toHaveProperty('password_hash');
    expect(JSON.stringify(register.body)).not.toContain(password);

    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.sessionToken).toBeTruthy();
    // Login rotates the token — a fresh mint, not the one from registration.
    expect(login.body.sessionToken).not.toBe(register.body.sessionToken);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'not-the-password-1!' });
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('nobody'), password: 'whatever-12345!' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail('auth-dup');
    const first = await request(app).post('/api/users').send({ email, password: GOOD_PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/users').send({ email, password: GOOD_PASSWORD });
    expect(second.status).toBe(409);
  });

  it('rejects a value that is not a valid email shape (also blocks the guest namespace)', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'guest:not-allowed', password: GOOD_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('rejects registration with too-short a password', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: uniqueEmail('short-pw'), password: 'sh0rt!' });
    expect(res.status).toBe(400);
  });

  it('rejects registration with a password that lacks complexity', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: uniqueEmail('weak-pw'), password: 'alllowercaseletters' });
    expect(res.status).toBe(400);
  });

  it('lets a legacy (pre-password) user log in on their old token but not via email/password, and claim a password', async () => {
    // Simulate an account created before this feature shipped: a row with a
    // session token but no password_hash.
    const legacyDb = new Database();
    await legacyDb.connect();
    const userId = uuidv4();
    const legacyToken = newSessionToken();
    const email = uniqueEmail('legacy');
    await legacyDb.createUser(userId, email, 'Legacy Tester', hashToken(legacyToken));
    await legacyDb.close();

    // Old session still works.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(me.status).toBe(200);
    expect(me.body.hasPassword).toBe(false);

    // But email/password login is refused — same generic body as any
    // other failed login, not a distinct "no password set" message.
    const attemptedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'anything-at-all-12!' });
    expect(attemptedLogin.status).toBe(401);
    expect(attemptedLogin.body).toEqual({ error: 'Invalid email or password' });

    // Claim a password using the still-valid old token.
    const claim = await request(app)
      .post('/api/auth/claim')
      .set('Authorization', `Bearer ${legacyToken}`)
      .send({ password: GOOD_PASSWORD });
    expect(claim.status).toBe(200);
    expect(claim.body.hasPassword).toBe(true);

    // Now email/password login works.
    const login = await request(app).post('/api/auth/login').send({ email, password: GOOD_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('logs out: the token stops working on REST immediately after', async () => {
    const email = uniqueEmail('logout-user');
    const register = await request(app).post('/api/users').send({ email, password: GOOD_PASSWORD });
    const token = register.body.sessionToken;

    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('resets a forgotten password end-to-end via a minted reset token', async () => {
    const email = uniqueEmail('reset-user');
    const register = await request(app).post('/api/users').send({ email, password: GOOD_PASSWORD });
    expect(register.status).toBe(201);

    // /forgot-password never reveals the token (it'd go out over email in
    // prod); mint one the same way the route does and store it directly,
    // exercising the same DB helpers the route calls.
    const resetToken = newSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
    await db.setUserResetToken(register.body.id, hashToken(resetToken), expiresAt);

    const newPassword = 'new-password-9#';
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, password: newPassword });
    expect(reset.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login').send({ email, password: GOOD_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/auth/login').send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);

    // The reset token is single-use.
    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, password: 'another-1!password' });
    expect(reuse.status).toBe(400);
  });

  it('forgot-password responds the same whether or not the email is registered', async () => {
    const registeredEmail = uniqueEmail('fp-known');
    await request(app).post('/api/users').send({ email: registeredEmail, password: GOOD_PASSWORD });

    const known = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: registeredEmail });
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: uniqueEmail('fp-unknown') });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });
});
