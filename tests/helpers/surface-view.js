import { expect } from '@playwright/test';

// A browser without WebGPU now opens a series in the volume view too (the WebGL volume, docs/webgl-volume.js), like a PC with WebGPU. The specs about the SURFACE (mesh) view
// go there the way a user does, with the 3D view's mode button (メッシュで確認), and test what the mesh view does; the volume view of such a browser is covered by no-webgpu.spec.js.
export async function toSurfaceView(page) {
  const mode = () => page.evaluate(async () => (await import('./state.js' + new URL(document.querySelector('script[src*="app.js"]').src).search)).threeRenderMode);
  if ((await mode()) === 'volume') await page.evaluate(() => document.getElementById('render-mode-toggle').click());
  await expect.poll(mode, { timeout: 60_000 }).toBe('surface');
  await expect(page.locator('#three-busy')).toHaveClass(/is-hidden/, { timeout: 60_000 }); // the surface is built (the busy overlay is gone)
  await page.waitForTimeout(300);
}

// the same without the build the mode button starts (a spec that counts what is built / cached itself): the volume is put away as the button does (app.js deactivateMedicalVolume)
export async function toSurfaceViewQuiet(page) {
  await page.evaluate(async () => {
    const q = new URL(document.querySelector('script[src*="app.js"]').src).search, st = await import('./state.js' + q), dl = await import('./data-load.js' + q), ov = await import('./mpr3d-overlay.js' + q);
    st.sceneState?.medicalVolume?.setActive(false); dl.setThreeVolumeOverlay(false); st.setThreeRenderMode('surface'); ov.syncMpr3DOverlayPresentation(); dl.updateRenderModeControl();
  });
}
