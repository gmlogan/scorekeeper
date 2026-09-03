import { test as base, expect } from '@playwright/test';

const uniqueName = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

export const test = base.extend({
  gameSetup: async ({ request }, use) => {
    const host = await createUser(request, uniqueName('host'));
    const guest = await createUser(request, uniqueName('guest'));
    const game = await createGame(request, host, uniqueName('game'));
    await joinGame(request, game.code, guest.username);

    await use({ host, guest, game });

    await request.delete('/api/games/hosted', { headers: authHeaders(host) });
  },
});

export { expect };

const authHeaders = (user) => ({
  'x-user-id': user.id,
  'x-session-token': user.sessionToken,
});

const createUser = async (request, username) => {
  const id = crypto.randomUUID();
  const sessionToken = `test-token-${id}`;
  const response = await request.post('/api/users', {
    data: { username },
    headers: {
      'x-user-id': id,
      'x-session-token': sessionToken,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return { id: body.id || id, username, sessionToken };
};

const createGame = async (request, user, name) => {
  const response = await request.post('/api/games', {
    data: { name, players: [] },
    headers: authHeaders(user),
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
};

const joinGame = async (request, code, username) => {
  const response = await request.post('/api/games/join', {
    data: { code, username },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
};

export const openGame = async (page, user, gameId) => {
  await page.addInitScript(({ id, username, sessionToken }) => {
    localStorage.setItem('userId', id);
    localStorage.setItem('username', username);
    localStorage.setItem('sessionToken', sessionToken);
  }, user);
  await page.goto(`/game/${gameId}`);
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
};