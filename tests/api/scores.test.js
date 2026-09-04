import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, db } from '../../backend/src/server.js';

const createUser = async (username) => {
  const response = await request(app)
    .post('/api/users')
    .send({ username, password: 'test-password-1234' });
  expect(response.status).toBe(201);
  expect(response.body.sessionToken).toBeTruthy();
  return { id: response.body.id, sessionToken: response.body.sessionToken };
};

const authHeader = (user) => `Bearer ${user.sessionToken}`;

describe('score API', () => {
  let host;
  let game;

  beforeAll(async () => {
    await db.connect();
    host = await createUser(`api-host-${Date.now()}`);
    const response = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader(host))
      .send({ name: `api-game-${Date.now()}`, players: [] });
    expect(response.status).toBe(201);
    game = response.body;
  });

  afterAll(async () => {
    await request(app)
      .delete('/api/games/hosted')
      .set('Authorization', authHeader(host));
    await db.close();
  });

  it('rejects an unauthenticated score change', async () => {
    const res = await request(app)
      .post(`/api/scores/games/${game.id}/players/${host.id}/update`)
      .send({ changeAmount: 5 });
    expect(res.status).toBe(401);
  });

  it('rejects a score change with a bogus token', async () => {
    const res = await request(app)
      .post(`/api/scores/games/${game.id}/players/${host.id}/update`)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ changeAmount: 5 });
    expect(res.status).toBe(401);
  });

  it('persists an authorized score change', async () => {
    const update = await request(app)
      .post(`/api/scores/games/${game.id}/players/${host.id}/update`)
      .set('Authorization', authHeader(host))
      .send({ changeAmount: 5 });

    expect(update.status).toBe(200);
    expect(update.body.newScore).toBe(5);

    const current = await request(app).get(`/api/games/${game.id}`);
    const player = current.body.players.find(({ player_id }) => player_id === host.id);
    expect(player.current_score).toBe(5);
  });

  it('serializes concurrent score changes without losing increments', async () => {
    const updates = await Promise.all(
      Array.from({ length: 5 }, () => request(app)
        .post(`/api/scores/games/${game.id}/players/${host.id}/update`)
        .set('Authorization', authHeader(host))
        .send({ changeAmount: 1 }))
    );

    expect(updates.every((response) => response.status === 200)).toBe(true);
    const current = await request(app).get(`/api/games/${game.id}`);
    const player = current.body.players.find(({ player_id }) => player_id === host.id);
    expect(player.current_score).toBe(10);
  });

  it('returns the delta when setting an absolute score', async () => {
    const update = await request(app)
      .post(`/api/scores/games/${game.id}/players/${host.id}/set`)
      .set('Authorization', authHeader(host))
      .send({ score: 3 });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ previousScore: 10, newScore: 3, changeAmount: -7 });
  });
});
