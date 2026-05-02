const { test, expect } = require('@playwright/test');

async function collectPageIssues(page) {
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon\.ico/i.test(text)) return;
    if (/assets\/music\/bg_game\.mp3/i.test(text)) return;
    consoleErrors.push(text);
  });

  return { pageErrors, consoleErrors };
}

test.describe('UI device pass', () => {
  test('guest flow reaches multiplayer room screen cleanly', async ({ page }, testInfo) => {
    const issues = await collectPageIssues(page);

    await page.goto('/');
    await expect(page.locator('#nameScreen')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('01-name-screen.png'), fullPage: true });

    await page.fill('#liUsername', 'UITESTER');
    await page.click('text=PLAY AS GUEST');
    await expect(page.locator('#modeScreen')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('02-mode-screen.png'), fullPage: true });

    await page.click('text=MULTIPLAYER');
    await expect(page.locator('#roomScreen')).toBeVisible();
    await expect(page.locator('#roomScreenTitle')).toContainText('MULTIPLAYER');
    await page.screenshot({ path: testInfo.outputPath('03-room-screen.png'), fullPage: true });

    expect.soft(issues.pageErrors, `Page errors: ${issues.pageErrors.join('\n')}`).toEqual([]);
    expect.soft(issues.consoleErrors, `Console errors: ${issues.consoleErrors.join('\n')}`).toEqual([]);
  });

  test('guest flow reaches pvp room screen cleanly', async ({ page }, testInfo) => {
    const issues = await collectPageIssues(page);

    await page.goto('/');
    await expect(page.locator('#nameScreen')).toBeVisible();

    await page.fill('#liUsername', 'PVPTESTER');
    await page.click('text=PLAY AS GUEST');
    await expect(page.locator('#modeScreen')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('04-mode-screen-pvp.png'), fullPage: true });

    await page.locator('.mode-card.pvp').click();
    await expect(page.locator('#roomScreen')).toBeVisible();
    await expect(page.locator('#roomScreenTitle')).toContainText('PVP');
    await page.screenshot({ path: testInfo.outputPath('05-pvp-room-screen.png'), fullPage: true });

    expect.soft(issues.pageErrors, `Page errors: ${issues.pageErrors.join('\n')}`).toEqual([]);
    expect.soft(issues.consoleErrors, `Console errors: ${issues.consoleErrors.join('\n')}`).toEqual([]);
  });

  test('solo game screen loads and mobile controls render on small devices', async ({ page }, testInfo) => {
    const issues = await collectPageIssues(page);

    await page.goto('/');
    await page.fill('#liUsername', 'MOBILETEST');
    await page.click('text=PLAY AS GUEST');
    await expect(page.locator('#modeScreen')).toBeVisible();

    await page.click('text=SOLO PLAY');
    await expect(page.locator('#gameScreen')).toBeVisible();
    await expect(page.locator('#gameCanvas')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: testInfo.outputPath('06-game-screen.png'), fullPage: true });

    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 430) {
      await expect(page.locator('#mobileControls')).toBeVisible();
    }

    expect.soft(issues.pageErrors, `Page errors: ${issues.pageErrors.join('\n')}`).toEqual([]);
    expect.soft(issues.consoleErrors, `Console errors: ${issues.consoleErrors.join('\n')}`).toEqual([]);
  });
});
