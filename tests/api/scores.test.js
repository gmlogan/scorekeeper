import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, db } from '../../backend/src/server.js';

const createUser = async (username) => {
  const id = crypto.randomUUID();
  const sessionToken = `test-token-${id}`;
  const response = await request(app)
    .post('/api/users')
    .set('x-user-id', id)
    .set('x-session-token', sessionToken)
    .send({ username });
  expect(response.status).toBe(201);
  return { id: response.body.id || id, sessionToken };
};

describe('score API', () => {
  let host;
  let game;

  beforeAll(async () => {
    await db.connect();
    host = await createUser(`api-host-${Date.now()}`);
    const response = await request(app)
      .post('/api/games')
      .set('x-user-id', host.id)
      .set('x-session-token', host.sessionToken)
      .send({ name: `api-game-${Date.now()}`, players: [] });
    expect(response.status).toBe(201);
    game = response.body;
  });

  afterAll(async () => {
    await request(app)
      .delete('/api/games/hosted')
      .set('x-user-id', host.id)
      .set('x-session-token', host.sessionToken);
    await db.close();
  });

  it('persists an authorized score change', async () => {
    const update = await request(app)
      .post(`/api/scores/games/${game.id}/players/${host.id}/update`)
      .set('x-user-id', host.id)
      .set('x-session-token', host.sessionToken)
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
        .set('x-user-id', host.id)
        .set('x-session-token', host.sessionToken)
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
      .set('x-user-id', host.id)
      .set('x-session-token', host.sessionToken)
      .send({ score: 3 });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ previousScore: 10, newScore: 3, changeAmount: -7 });
  });
});