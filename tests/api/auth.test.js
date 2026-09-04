import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, db } from '../../backend/src/server.js';
import Database from '../../backend/src/models/database.js';
import { newSessionToken, hashToken } from '../../backend/src/lib/token.js';
import { randomUUID as uuidv4 } from 'crypto';

const uniqueUsername = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

describe('auth API', () => {
  beforeAll(async () => {
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
  });

  it('registers, logs in, and rejects the wrong password with the same body as an unknown username', async () => {
    const username = uniqueUsername('auth-user');
    const password = 'correct-horse-battery';

    const register = await request(app).post('/api/users').send({ username, password });
    expect(register.status).toBe(201);
    expect(register.body.sessionToken).toBeTruthy();
    expect(register.body).not.toHaveProperty('password');
    expect(register.body).not.toHaveProperty('password_hash');
    expect(JSON.stringify(register.body)).not.toContain(password);

    const login = await request(app).post('/api/auth/login').send({ username, password });
    expect(login.status).toBe(200);
    expect(login.body.sessionToken).toBeTruthy();
    // Login rotates the token — a fresh mint, not the one from registration.
    expect(login.body.sessionToken).not.toBe(register.body.sessionToken);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ username, password: 'not-the-password' });
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ username: uniqueUsername('nobody'), password: 'whatever12345' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it('rejects a duplicate username with 409', async () => {
    const username = uniqueUsername('auth-dup');
    const first = await request(app)
      .post('/api/users')
      .send({ username, password: 'first-password-1' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/users')
      .send({ username, password: 'second-password-2' });
    expect(second.status).toBe(409);
  });

  it('rejects a username containing the guest namespace separator', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'guest:not-allowed', password: 'password12345' });
    expect(res.status).toBe(400);
  });

  it('rejects registration with too-short a password', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: uniqueUsername('short-pw'), password: 'short' });
    expect(res.status).toBe(400);
  });

  it('lets a legacy (pre-password) user log in on their old token but not via username/password, and claim a password', async () => {
    // Simulate an account created before this feature shipped: a row with a
    // session token but no password_hash.
    const legacyDb = new Database();
    await legacyDb.connect();
    const userId = uuidv4();
    const legacyToken = newSessionToken();
    const username = uniqueUsername('legacy');
    await legacyDb.createUser(userId, username, 'Legacy Tester', hashToken(legacyToken));
    await legacyDb.close();

    // Old session still works.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(me.status).toBe(200);
    expect(me.body.hasPassword).toBe(false);

    // But username/password login is refused — same generic body as any
    // other failed login, not a distinct "no password set" message.
    const attemptedLogin = await request(app)
      .post('/api/auth/login')
      .send({ username, password: 'anything-at-all-12' });
    expect(attemptedLogin.status).toBe(401);
    expect(attemptedLogin.body).toEqual({ error: 'Invalid username or password' });

    // Claim a password using the still-valid old token.
    const claim = await request(app)
      .post('/api/auth/claim')
      .set('Authorization', `Bearer ${legacyToken}`)
      .send({ password: 'newly-claimed-pw' });
    expect(claim.status).toBe(200);
    expect(claim.body.hasPassword).toBe(true);

    // Now username/password login works.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username, password: 'newly-claimed-pw' });
    expect(login.status).toBe(200);
  });

  it('logs out: the token stops working on REST immediately after', async () => {
    const username = uniqueUsername('logout-user');
    const register = await request(app)
      .post('/api/users')
      .send({ username, password: 'logout-password-1' });
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
});
