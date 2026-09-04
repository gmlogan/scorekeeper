import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, db } from '../../backend/src/server.js';

const uniqueEmail = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;

const createUser = async (email, displayName) => {
  const response = await request(app)
    .post('/api/users')
    .send({ email, password: 'test-password-1234!' });
  expect(response.status).toBe(201);
  const user = { id: response.body.id, sessionToken: response.body.sessionToken };

  await request(app)
    .patch('/api/users/me')
    .set('Authorization', authHeader(user))
    .send({ displayName });

  return user;
};

const authHeader = (user) => `Bearer ${user.sessionToken}`;

describe('joining a game with a display_name that collides', () => {
  let host;
  let dad1;
  let dad2;
  let game;

  beforeAll(async () => {
    await db.connect();
    host = await createUser(uniqueEmail('jc-host'), 'Host');
    dad1 = await createUser(uniqueEmail('jc-dad1'), 'Dad');
    dad2 = await createUser(uniqueEmail('jc-dad2'), 'Dad');

    const created = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader(host))
      .send({ name: uniqueEmail('jc-game') });
    game = created.body;
  });

  afterAll(async () => {
    await request(app).delete('/api/games/hosted').set('Authorization', authHeader(host));
    await db.close();
  });

  it('lets the first "Dad" join with their real display_name', async () => {
    const join = await request(app)
      .post('/api/games/join')
      .set('Authorization', authHeader(dad1))
      .send({ code: game.code });
    expect(join.status).toBe(200);
    expect(join.body.players.map((p) => p.display_name)).toContain('Dad');
  });

  it('blocks the second "Dad" without a temp name, then accepts one with it', async () => {
    const blocked = await request(app)
      .post('/api/games/join')
      .set('Authorization', authHeader(dad2))
      .send({ code: game.code });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DUPLICATE_NAME');

    const joined = await request(app)
      .post('/api/games/join')
      .set('Authorization', authHeader(dad2))
      .send({ code: game.code, tempDisplayName: 'Dad (2)' });
    expect(joined.status).toBe(200);

    const names = joined.body.players.map((p) => p.display_name);
    expect(names).toContain('Dad');
    expect(names).toContain('Dad (2)');
  });

  it('does not touch the account\'s real display_name outside this game', async () => {
    const me = await request(app).get('/api/auth/me').set('Authorization', authHeader(dad2));
    expect(me.body.display_name).toBe('Dad');
  });
});
