import { test, expect, openGame } from './fixtures';

const authHeaders = (user) => ({ Authorization: `Bearer ${user.sessionToken}` });

test('score updates are visible to another player', async ({ browser, gameSetup }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  await openGame(hostPage, gameSetup.host, gameSetup.game.id);
  await openGame(guestPage, gameSetup.guest, gameSetup.game.id);
  await hostPage.waitForTimeout(500);
  await guestPage.waitForTimeout(500);

  await hostPage.getByText('(You)').click();
  const addButton = hostPage.getByRole('button', { name: '+' });
  await addButton.click({ clickCount: 5 });
  await expect(hostPage.getByText('5', { exact: true }).last()).toBeVisible();

  await expect(
    guestPage.locator('div.card').filter({ hasText: gameSetup.host.username }).getByText('5', { exact: true })
  ).toBeVisible({ timeout: 5_000 });

  await hostContext.close();
  await guestContext.close();
});

test('host manages a typed-in guest\'s score; a code-joiner only manages their own', async ({
  browser,
  request,
  gameSetup,
}) => {
  // gameSetup's game was created with no typed-in players — add one now via
  // the same createGame players[] path the app uses (see CreateGame.jsx).
  const response = await request.post('/api/games', {
    data: { name: 'guest-mgmt-game', players: ['Guest One'] },
    headers: authHeaders(gameSetup.host),
  });
  expect(response.ok()).toBeTruthy();
  const game = await response.json();
  await request.post('/api/games/join', {
    data: { code: game.code },
    headers: authHeaders(gameSetup.guest),
  });

  const hostContext = await browser.newContext();
  const joinerContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const joinerPage = await joinerContext.newPage();

  await openGame(hostPage, gameSetup.host, game.id);
  await openGame(joinerPage, gameSetup.guest, game.id);

  // Host selects the typed-in guest and can adjust their score.
  await hostPage.getByText('Guest One').click();
  await expect(hostPage.getByText("guest — you're managing this")).toBeVisible();
  await hostPage.getByRole('button', { name: '+' }).click({ clickCount: 3 });
  await expect(hostPage.getByText('Current Score')).toBeVisible();
  await expect(hostPage.locator('.text-5xl')).toHaveText('3');

  // The code-joiner selecting the guest's row gets no edit controls (not their own score, not host).
  await joinerPage.getByText('Guest One').click();
  await expect(joinerPage.getByRole('button', { name: '+' })).toHaveCount(0);

  await hostContext.close();
  await joinerContext.close();
});