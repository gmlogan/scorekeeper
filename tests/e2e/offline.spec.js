import { test, expect } from '@playwright/test';

const uniqueName = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
// The frontend's own VITE_API_URL/VITE_WS_URL env (set by whichever
// webServer config is running this) is what the app actually talks to; the
// `request` fixture needs the same target explicitly since it doesn't go
// through the page's dev-server proxy.
const API_URL = process.env.OFFLINE_TEST_API_URL || 'http://localhost:5000';

test('create a game, add a guest, and track scores fully offline, then sync', async ({ page, request }) => {
  // Well past the 30s default: this test alone spends up to 30s waiting for
  // the WS backoff reconnect, on top of every step before it.
  test.setTimeout(90_000);
  const username = uniqueName('offline-host');
  const res = await request.post(`${API_URL}/api/users`, {
    data: { email: `${username}@example.com`, password: 'test-password-1234!' },
  });
  expect(res.ok()).toBeTruthy();
  const user = await res.json();

  await page.addInitScript(({ id, sessionToken }) => {
    localStorage.setItem('userId', id);
    localStorage.setItem('username', 'Offline Host');
    localStorage.setItem('sessionToken', sessionToken);
  }, { id: user.id, sessionToken: user.sessionToken });

  // The app's own "online" signal is the WS connection (GameContext),
  // deliberately more reliable than navigator.onLine — so simulate offline
  // by refusing the socket specifically, rather than context.setOffline()
  // (which wouldn't tear down an already-open WS anyway). REST still works
  // through this route, matching a real flaky-WS-but-reachable-CDN case, and
  // deferred create/score ops never call REST in the first place while
  // !isConnected, so that's not what's under test here.
  //
  // Playwright has no `unrouteWebSocket`/`unrouteAll` support for routes
  // registered via `routeWebSocket` (unrouteAll only covers `route()` and
  // `routeFromHAR()` — confirmed against @playwright/test 1.62.1's own
  // WebSocketRoute docs), so "go back online" below is a flag flip read by
  // this same handler, not a route removal.
  let simulateOffline = true;
  await page.routeWebSocket('**/ws', (ws) => {
    if (simulateOffline) ws.close();
    else ws.connectToServer();
  });
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Create Scoreboard' })).toBeVisible();
  await expect(page.getByText(/Offline —/)).toBeVisible();

  const gameName = uniqueName('Offline Game');
  await page.getByPlaceholder('Catan Championship').fill(gameName);
  await page.getByPlaceholder('Add player name...').fill('Guest One');
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByText('Guest One')).toBeVisible();

  await page.getByRole('button', { name: /Create Scoreboard/ }).click();

  // Deferred-create path: no server round trip possible, so it should land
  // straight on the game screen under a local id, not the code-reveal step.
  await expect(page).toHaveURL(/\/game\/local-/, { timeout: 10_000 });
  await expect(page.getByText(/Offline —/)).toBeVisible();
  await expect(page.getByText(/pending — syncing/)).toBeVisible();
  await expect(page.getByText('Guest One')).toBeVisible();

  // The host can manage the guest's score even before the game has synced —
  // the locally-created guest row must carry is_guest itself, not rely on
  // the backend-computed value that only shows up after the real sync.
  await page.getByText('Guest One').click();
  await expect(page.getByRole('button', { name: '+' })).toBeVisible();

  // Score a few points for the host while offline.
  await page.getByText('(You)').click();
  const plus = page.getByRole('button', { name: '+' });
  await plus.click({ clickCount: 3 });
  await expect(page.locator('.text-5xl.font-bold.text-primary')).toHaveText('3');

  const localUrl = page.url();

  // Reload while still offline — state must survive from localStorage, not
  // just live React state.
  await page.reload();
  await expect(page.getByText(/Offline —/)).toBeVisible();
  await expect(page.locator('.text-3xl.font-bold.text-primary').first()).toHaveText('3');

  // Back online: the queued create should sync and the page should hop to
  // the real game id on its own. The WS hook backs off up to 10s between
  // reconnect attempts, so give this plenty of room.
  simulateOffline = false;
  await expect(page).not.toHaveURL(localUrl, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/game\/(?!local-)/, { timeout: 10_000 });
  await expect(page.getByText(/Offline —/)).not.toBeVisible();
  await expect(page.getByText(/^Code: [A-Z]{3}-\d{4}$/)).toBeVisible({ timeout: 10_000 });

  const realGameId = page.url().split('/game/')[1];
  const check = await request.get(`${API_URL}/api/games/${realGameId}`, {
    headers: { Authorization: `Bearer ${user.sessionToken}` },
  });
  expect(check.ok()).toBeTruthy();
  const body = await check.json();
  expect(body.players).toHaveLength(2);
  const host = body.players.find((p) => p.player_id === user.id);
  expect(host.current_score).toBe(3);
  const guest = body.players.find((p) => p.player_id !== user.id);
  expect(guest.display_name).toBe('Guest One');
  expect(guest.current_score).toBe(0);
});
