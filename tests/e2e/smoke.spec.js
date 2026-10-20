import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const { build } = JSON.parse(readFileSync('docs/version.json', 'utf8'));

// Collect uncaught errors for every test. CDN or module-graph breakage shows up
// here first, because the whole app is one ES module.
test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on('pageerror', err => testInfo.pageErrors.push(err.message));
});

test.afterEach(async ({}, testInfo) => {
  expect(testInfo.pageErrors, 'uncaught page errors').toEqual([]);
});

test('app boots and renders the main UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toBeEmpty();
  await expect(page.locator('#sample-demo-button')).toBeVisible();
  await expect(page.locator('#demo-button')).toHaveCount(0);
  await expect(page.locator('#gpu-status-bar')).toBeVisible(); // top chip hidden
  // GPU volume cache chip only appears with a WebGPU volume renderer (none in CI)
  await expect(page.locator('#volume-cache-clear')).toBeHidden();
  // 'original CT' badge exists but is hidden unless GPU volume + filters
  await expect(page.locator('#three-filter-badge')).toBeAttached();
  await expect(page.locator('#three-filter-badge')).toBeHidden();
  // 3D edit lasso tool is present (disabled until a 3D segment exists)
  await expect(page.locator('#analysis-lasso-select')).toBeAttached();
  await expect(page.locator('#analysis-lasso-select')).toBeDisabled();
});

test('version badge shows the deployed build and no reload loop occurs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-version-badge')).toContainText(`build ${build}`);
  // ensureLatestDeployedBuild() adds ?build=... when markers disagree.
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).searchParams.get('build')).toBeNull();
});

test('language toggle switches between Japanese and English', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-ipad-drawer-tab="prefs"]').click(); // language / theme live in the 設定 panel
  const toggle = page.locator('#language-toggle');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(toggle).toHaveText('English');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(toggle).toHaveText('日本語');
  await expect(page.locator('#sample-demo-button')).toContainText('Practice data');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});

// Workspace UI (iPad layout, used on every desktop);
// ?ui=classic must keep the old desktop layout.
test('workspace UI boots with its toolbar and drawer', async ({ page }) => {
  await page.goto('/?ui=workspace');
  await expect(page.locator('html')).toHaveClass(/vrl-ipad-ui/);
  await expect(page.locator('#ipad-workspace-toolbar')).toBeVisible();
  await expect(page.locator('#sample-demo-button')).toBeVisible();
  await expect(page.locator('#demo-button')).toHaveCount(0);
});

// the workspace UI is the default on every desktop OS (CI: Linux)
test('workspace UI is the default on desktops; classic can be forced', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/vrl-ipad-ui/);
  await page.goto('/?ui=classic');
  await expect(page.locator('html')).not.toHaveClass(/vrl-ipad-ui/);
});
