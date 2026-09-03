import { test, expect, openGame } from './fixtures';

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