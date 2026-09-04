import { test as base, expect } from '@playwright/test';

const uniqueName = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

export const test = base.extend({
  gameSetup: async ({ request }, use) => {
    const host = await createUser(request, uniqueName('host'));
    const guest = await createUser(request, uniqueName('guest'));
    const game = await createGame(request, host, uniqueName('game'));
    await joinGame(request, guest, game.code);

    await use({ host, guest, game });

    await request.delete('/api/games/hosted', { headers: authHeaders(host) });
  },
});

export { expect };

const authHeaders = (user) => ({
  Authorization: `Bearer ${user.sessionToken}`,
});

const createUser = async (request, username) => {
  const response = await request.post('/api/users', {
    data: { email: `${username}@example.com`, password: 'test-password-1234!' },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  // `username` here is only this fixture's display label (see openGame,
  // which writes it straight to localStorage) — unrelated to the account's
  // real login email above.
  return { id: body.id, username, sessionToken: body.sessionToken };
};

const createGame = async (request, user, name) => {
  const response = await request.post('/api/games', {
    data: { name, players: [] },
    headers: authHeaders(user),
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
};

const joinGame = async (request, user, code) => {
  const response = await request.post('/api/games/join', {
    data: { code },
    headers: authHeaders(user),
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