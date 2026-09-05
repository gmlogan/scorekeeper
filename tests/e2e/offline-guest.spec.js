import { test, expect } from '@playwright/test';

const uniqueName = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const API_URL = process.env.OFFLINE_TEST_API_URL || 'http://localhost:5000';

// Simulates a cold PWA launch with zero stored session AND no network — the
// app shell can still boot from the service worker cache, but there's no
// server to log in against. See Home.jsx's "Continue offline as guest" path.
test('cold offline launch offers a guest mode, then logs in to sync once back online', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  // A real account, created in advance, that the guest will log into once
  // back online — mirrors "log in on a device that already has an account".
  const email = `${uniqueName('sync-target')}@example.com`;
  const password = 'test-password-1234!';
  const signup = await request.post(`${API_URL}/api/users`, { data: { email, password } });
  expect(signup.ok()).toBeTruthy();

  // Same WS-offline simulation as offline.spec.js: refuse the socket, not
  // navigator.onLine, since that's the app's own connectivity signal.
  let simulateOffline = true;
  await page.routeWebSocket('**/ws', (ws) => {
    if (simulateOffline) ws.close();
    else ws.connectToServer();
  });

  // No addInitScript here at all — nothing in localStorage, exactly a first
  // launch.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText(/No connection yet/)).toBeVisible();

  await page.getByPlaceholder('Your name').fill('Offline Guest');
  await page.getByRole('button', { name: 'Continue offline as guest' }).click();

  // The button triggers window.location.reload(); wait for the real, signed-
  // in-as-guest home screen.
  await expect(page.getByRole('heading', { name: /Welcome back, Offline Guest/ })).toBeVisible();
  await expect(page.getByText('Create New Scoreboard')).toBeVisible();
  // Still offline — join needs a live connection, so it's disabled.
  await expect(page.getByText('Needs a connection.')).toBeVisible();

  await page.getByText('Create New Scoreboard').click();
  await expect(page.getByRole('heading', { name: 'Create Scoreboard' })).toBeVisible();

  const gameName = uniqueName('Guest Offline Game');
  await page.getByPlaceholder('Catan Championship').fill(gameName);
  await page.getByPlaceholder('Add player name...').fill('Guest One');
  await page.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: /Create Scoreboard/ }).click();

  await expect(page).toHaveURL(/\/game\/local-/, { timeout: 10_000 });
  await page.getByText('Offline Guest').click(); // the host's own row — "(You)"
  await page.getByRole('button', { name: '+' }).click({ clickCount: 3 });
  await expect(page.locator('.text-5xl.font-bold.text-primary')).toHaveText('3');

  const localUrl = page.url();

  // Back online, but still no account: the game must NOT be dropped (see
  // offlineSync.js's create-game guard) — instead a "log in to sync" banner
  // should appear right here on the game screen.
  simulateOffline = false;
  await expect(page.getByText("You're back online — log in to sync this game.")).toBeVisible({
    timeout: 15_000,
  });
  // Give the reconnect-triggered flush a beat to (not) run; the local game
  // must still be here, unsynced.
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(localUrl);

  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Sync your game' })).toBeVisible();

  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();

  // Reload reconnects the socket under the real account, which re-triggers
  // the queued create-game — GameBoard swaps to the real id on its own.
  await expect(page).not.toHaveURL(localUrl, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/game\/(?!local-)/, { timeout: 10_000 });
  await expect(page.getByText(/^Code: [A-Z]{3}-\d{4}$/)).toBeVisible({ timeout: 10_000 });

  const realGameId = page.url().split('/game/')[1];
  const login = await request.post(`${API_URL}/api/auth/login`, { data: { email, password } });
  const { sessionToken } = await login.json();
  const check = await request.get(`${API_URL}/api/games/${realGameId}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  expect(check.ok()).toBeTruthy();
  const body = await check.json();
  expect(body.players).toHaveLength(2);
  const guest = body.players.find((p) => p.is_guest);
  expect(guest.display_name).toBe('Guest One');
  const host = body.players.find((p) => !p.is_guest);
  expect(host.current_score).toBe(3);
});
