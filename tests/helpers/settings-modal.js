// 設定 is one large modal (#settings-dialog) in normal and event mode. The left rail's 設定 entry opens it; the page behind is inert while it is open.
import { expect } from '@playwright/test';

export const SETTINGS_ENTRY = '#ws-settings-entry';
export async function openSettings(page, tab) {
  await page.locator(SETTINGS_ENTRY).click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  if (tab) await page.locator(`[data-settings-tab="${tab}"]`).click();
}
export async function closeSettings(page) {
  await page.locator('#settings-close').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
}
