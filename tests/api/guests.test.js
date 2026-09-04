import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, db } from '../../backend/src/server.js';

const uniqueEmail = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;

const createUser = async (email) => {
  const response = await request(app)
    .post('/api/users')
    .send({ email, password: 'test-password-1234!' });
  expect(response.status).toBe(201);
  return { id: response.body.id, email, sessionToken: response.body.sessionToken };
};

const authHeader = (user) => `Bearer ${user.sessionToken}`;

describe('guest players (typed-in names on game creation)', () => {
  let host;
  let victim;

  beforeAll(async () => {
    await db.connect();
    host = await createUser(uniqueEmail('gt-host'));
    // The account whose email we'll try to "type in" as a guest.
    victim = await createUser(uniqueEmail('gt-victim'));
  });

  afterAll(async () => {
    await request(app).delete('/api/games/hosted').set('Authorization', authHeader(host));
    await db.close();
  });

  it('does not attach a real account to a game when a typed guest name matches its email', async () => {
    const game = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader(host))
      .send({ name: uniqueEmail('guest-test-game'), players: [victim.email] });
    expect(game.status).toBe(201);

    const playerIds = game.body.players.map((p) => p.player_id);
    // The victim's real account must NOT be a member of this game.
    expect(playerIds).not.toContain(victim.id);
    // A shadow guest row was created instead, showing the typed name.
    expect(game.body.players.map((p) => p.display_name)).toContain(victim.email);
  });

  it('never exposes a login email on the roster', async () => {
    const game = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader(host))
      .send({ name: uniqueEmail('guest-test-game2'), players: ['Some Guest'] });
    expect(game.status).toBe(201);
    for (const player of game.body.players) {
      expect(player).not.toHaveProperty('email');
    }
  });
});
