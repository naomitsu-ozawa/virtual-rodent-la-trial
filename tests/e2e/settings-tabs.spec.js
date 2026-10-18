import { test, expect } from '@playwright/test';

// build 604: the tabs of the 設定 panel (描画 / キャッシュ / 外観 / デバッグ) did nothing in the workspace UI - the dialog's
// content is moved into the panel, but the tab handlers looked the tabs up inside the (now empty) dialog.
test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on('pageerror', err => testInfo.pageErrors.push(err.message));
});
test.afterEach(async ({}, testInfo) => {
  expect(testInfo.pageErrors, 'uncaught page errors').toEqual([]);
});

const panels = page => page.evaluate(() => [...document.querySelectorAll('[data-settings-panel]')].filter(p => !p.hidden).map(p => p.dataset.settingsPanel));

test('設定 panel: every tab shows its own pane', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-ipad-drawer-tab="prefs"]').click();
  expect(await panels(page)).toEqual(['render']);
  for (const tab of ['cache', 'appearance', 'debug', 'render']) {
    await page.locator(`[data-settings-tab="${tab}"]`).click();
    expect(await panels(page)).toEqual([tab]);
    await expect(page.locator(`[data-settings-tab="${tab}"]`)).toHaveClass(/is-active/);
    await expect(page.locator(`[data-settings-panel="${tab}"]`)).toBeVisible();
  }
});

test('設定 panel: the debug switch reveals the GPU tab, which opens its pane', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-ipad-drawer-tab="prefs"]').click();
  await expect(page.locator('[data-settings-tab="gpu"]')).toBeHidden();
  await page.locator('[data-settings-tab="debug"]').click();
  await page.locator('#set-debug').check();
  await expect(page.locator('[data-settings-tab="gpu"]')).toBeVisible();
  await page.locator('[data-settings-tab="gpu"]').click();
  expect(await panels(page)).toEqual(['gpu']);
});
