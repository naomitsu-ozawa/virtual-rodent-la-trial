import { test, expect } from '@playwright/test';
import { makeCtSlice } from '../helpers/synthetic-dicom.js';

// The trial reads the bundled practice data only: no file input, no directory-picker control, and a file
// dropped on the page is not read.
test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on('pageerror', err => testInfo.pageErrors.push(err.message));
});
test.afterEach(async ({}, testInfo) => {
  expect(testInfo.pageErrors, 'uncaught page errors').toEqual([]);
});

for (const ui of ['workspace', 'classic']) {
  test(`no file input and no directory-picker control (${ui} layout)`, async ({ page }) => {
    let pickers = 0;
    await page.addInitScript(() => { window.__pickerCalls = 0; window.showDirectoryPicker = async () => { window.__pickerCalls++; throw new DOMException('no picker', 'AbortError'); }; });
    page.on('filechooser', () => { pickers++; });
    await page.goto(`/?ui=${ui}`);
    await expect(page.locator('#sample-demo-button')).toBeVisible();
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    await expect(page.locator('[webkitdirectory]')).toHaveCount(0);
    await expect(page.locator('#open-folder, #folder-input, #project-open, #project-input, #project-save')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /フォルダ|folder|プロジェクト|project/i })).toHaveCount(0);
    // the practice-data button only opens the practice-data chooser
    await page.locator('#sample-demo-button').click();
    await expect(page.locator('[data-sample-set]')).toHaveCount(4);
    expect(pickers).toBe(0);
    expect(await page.evaluate(() => window.__pickerCalls)).toBe(0);
  });
}

test('a file dropped on the page loads nothing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toBeEmpty();
  const pixels = new Int16Array(16 * 16).map((_, i) => (i % 7) * 200);
  const bytes = Array.from(makeCtSlice({ rows: 16, columns: 16, pixelSpacing: [0.1, 0.1], position: [0, 0, 0], instance: 1, pixels }));
  await page.evaluate(b => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(b)], 'slice.dcm', { type: 'application/dicom' }));
    const targets = [document.body, document.querySelector('#app'), document.querySelector('#viewport-3d'), document.querySelector('#scan-state')].filter(Boolean);
    for (const el of targets) for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, bytes);
  await page.waitForTimeout(1500);
  await expect(page.locator('#series-list .series-card')).toHaveCount(0);
  await expect(page.locator('#scan-state')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#scan-state strong')).toHaveText(/データを選択してください|Select data/);
  await expect(page.locator('#scan-progress')).toHaveClass(/is-hidden/);
});
