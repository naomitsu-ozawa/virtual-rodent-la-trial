import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import dicomParser from 'dicom-parser';
import { makeCtSlice } from '../helpers/synthetic-dicom.js';

// crop a cube out of the loaded series and export it as DICOM. The in-repo practice data slot (demo/sample1) is stubbed with a
// synthetic 64x64x40 series (isotropic 0.1 mm); showDirectoryPicker is removed so the .zip path runs (the headless browser has no picker).
// The zip is unpacked here and every voxel is compared with the source values: an axis-aligned crop must be an exact copy, and a
// 90 degree turn with nearest interpolation must reproduce exact source values.
const valueAt = (i, j, k) => ((i * 37 + j * 91 + k * 53) % 1500) - 200;
const makeSet = (W, H, D) => {
  const names = Array.from({ length: D }, (_, z) => `slice${String(z).padStart(3, '0')}.dcm`);
  const slices = names.map((_, k) => Buffer.from(makeCtSlice({
    rows: H, columns: W, pixelSpacing: [0.1, 0.1], thickness: 0.1, position: [0, 0, k * 0.1], orientation: [1, 0, 0, 0, 1, 0], instance: k + 1, intercept: -1024,
    pixels: Int16Array.from({ length: W * H }, (_, n) => valueAt(n % W, Math.floor(n / W), k)),
  })));
  return { W, H, D, names, slices };
};
const SMALL = makeSet(64, 64, 40), W = 64, H = 64, D = 40;

async function openSample(page, set = SMALL) {
  const { names, slices } = set;
  await page.addInitScript(() => { window.showDirectoryPicker = undefined; });
  await page.route('**/demo/sample1/index.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'Synthetic', files: names }) }));
  await page.route('**/demo/sample1/*.dcm', route => {
    const i = names.indexOf(decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()));
    return i < 0 ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'application/dicom', body: slices[i] });
  });
  await page.route('**/demo/sample1/project.vrlab', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await page.locator('#sample-demo-button').click();
  await page.locator('[data-sample-set="sample1"]').click();
  await expect(page.locator('.ready-badge').first()).toContainText(/ready/i, { timeout: 60_000 });
}
const setRange = (page, id, value) => page.evaluate(([i, v]) => { const e = document.getElementById(i); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); }, [id, value]);
async function exportZip(page) {
  const download = page.waitForEvent('download');
  await page.locator('#crop-run').click();
  const d = await download, files = unzipSync(new Uint8Array(readFileSync(await d.path())));
  return { name: d.suggestedFilename(), files, keys: Object.keys(files).sort() };
}
const parse = bytes => { const ds = dicomParser.parseDicom(bytes), e = ds.elements.x7fe00010; return { ds, px: new Int16Array(bytes.slice(e.dataOffset, e.dataOffset + e.length).buffer) }; };

test('crop export: exact copy when axis aligned, exact values for a 90 degree turn (nearest)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openSample(page);
  await expect(page.locator('[data-dock-tool="crop"]')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#crop-export-panel')).toBeHidden();
  await page.locator('[data-ipad-drawer-tab="crop"]').click(); await page.locator('[data-dock-tool="crop"]').click();
  await expect(page.locator('#crop-export-panel')).toBeVisible();
  await page.selectOption('#crop-size', '128');
  await expect(page.locator('#crop-mode')).toContainText('元の値');
  await expect(page.locator('#crop-interp')).toBeDisabled(); // not rotated: no interpolation
  // the default box is centred: centre (31.5, 31.5, 19.5), 128 voxels -> start voxel (-32, -32, -44); outside the series = fill (air: -1024 HU = stored 0)
  let r = await exportZip(page);
  expect(r.name).toBe('slice_crop128.zip'); expect(r.keys.length).toBe(128);
  let bad = 0, outsideBad = 0;
  r.keys.forEach((key, c) => {
    const { px } = parse(r.files[key]);
    for (let b = 0; b < 128; b++) for (let a = 0; a < 128; a++) {
      const i = a - 32, j = b - 32, k = c - 44, inside = i >= 0 && i < W && j >= 0 && j < H && k >= 0 && k < D;
      if (inside ? px[b * 128 + a] !== valueAt(i, j, k) : px[b * 128 + a] !== 0) { bad++; if (!inside) outsideBad++; }
    }
  });
  expect(bad, 'voxels that differ from the source').toBe(0); expect(outsideBad).toBe(0);
  const d0 = parse(r.files[r.keys[0]]).ds;
  expect(d0.string('x0008103e')).toBe('Test CT crop 128 (not resampled)'); expect(d0.string('x00280030')).toBe('0.1\\0.1');
  expect(d0.string('x0020000d')).toBe('1.2.3'); expect(d0.string('x0020000e')).not.toBe('1.2.3.4');
  // rotated by 90 degrees about Z, nearest: out(a,b,c) <- source(cx-(b-h), cy+(a-h), cz+(c-h)), h = 63.5
  await setRange(page, 'crop-rot-z', 90); await page.selectOption('#crop-interp', 'nearest');
  await expect(page.locator('#crop-mode')).toContainText('補間あり');
  r = await exportZip(page);
  expect(r.keys.length).toBe(128); bad = 0;
  r.keys.forEach((key, c) => {
    const { px } = parse(r.files[key]);
    for (let b = 0; b < 128; b++) for (let a = 0; a < 128; a++) {
      const i = Math.round(31.5 - (b - 63.5)), j = Math.round(31.5 + (a - 63.5)), k = Math.round(19.5 + (c - 63.5)), inside = i >= 0 && i < W && j >= 0 && j < H && k >= 0 && k < D;
      if (px[b * 128 + a] !== (inside ? valueAt(i, j, k) : 0)) bad++;
    }
  });
  expect(bad, 'voxels that differ from the expected source values').toBe(0);
  const r0 = parse(r.files[r.keys[0]]).ds;
  expect(r0.string('x0008103e')).toBe('Test CT crop 128 resampled (nearest)');
  expect(r0.string('x00200037').split('\\').map(Number)).toEqual([0, 1, 0, -1, 0, 0]); // the series' orientation is identity (a series without position / orientation tags cannot be rotated): rows -> +y, columns -> -x
  expect(errors).toEqual([]);
});

test('crop export: the box is drawn in the slice views and follows the position sliders', async ({ page }) => {
  test.setTimeout(90_000);
  await openSample(page, makeSet(160, 160, 140));
  await expect(page.locator('[data-dock-tool="crop"]')).toBeEnabled({ timeout: 30_000 });
  await page.locator('[data-ipad-drawer-tab="crop"]').click(); await page.locator('[data-dock-tool="crop"]').click();
  await page.locator('button', { hasText: /^2D$/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  const pinkPixels = () => page.evaluate(() => {
    const cv = document.getElementById('axial-crosshair'); if (!cv || !cv.width) return -1;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 220 && d[i + 1] < 140 && d[i + 2] > 170) n++;
    return n;
  });
  await page.selectOption('#crop-size', '128'); await setRange(page, 'crop-pos-z', 69.5);
  await expect.poll(pinkPixels, { timeout: 30_000 }).toBeGreaterThan(50);
  await setRange(page, 'crop-pos-z', 100); // the axial slice follows the box centre (z 36..163 still cuts the volume)
  await expect.poll(pinkPixels, { timeout: 30_000 }).toBeGreaterThan(50);
  // 3D: the synthetic CT has no tissue the segment presets would turn into a mesh, so the scene has no object yet (see hu-line.spec.js): stand in a plain group
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[src*="app.js"]').src).search;
    const st = await import('./state.js' + v), THREE = await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js');
    const s = st.sceneState; if (!s.obj) { s.obj = new THREE.Group(); s.scene.add(s.obj); }
    s.needsRender = true;
  });
  await page.locator('button', { hasText: /^3D$/ }).first().click().catch(() => {});
  await expect.poll(() => page.evaluate(() => document.querySelector('svg.crop-3d')?.dataset.visible || ''), { timeout: 30_000 }).toBe('1');
  const shown = () => page.evaluate(() => [...document.querySelectorAll('svg.crop-3d line')].filter(l => l.getAttribute('visibility') === 'visible').length);
  await expect.poll(shown, { timeout: 30_000 }).toBe(24); // 12 edges, each a dark halo and a coloured line
  await page.locator('#crop-close').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('svg.crop-3d')?.dataset.visible || ''), { timeout: 10_000 }).toBe('0');
  if (process.env.CROP_SHOT) { await page.locator('[data-ipad-drawer-tab="crop"]').click(); await page.locator('[data-dock-tool="crop"]').click(); await page.screenshot({ path: process.env.CROP_SHOT }); }
});

// ---- rotate by dragging next to a corner in a slice view (no rotation sliders) ----
test('crop export: drag-rotate in the axial view, snapping back to 0 gives the exact byte copy', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const W2 = 256, H2 = 256, D2 = 48, big = makeSet(W2, H2, D2);
  await openSample(page, big);
  await expect(page.locator('[data-dock-tool="crop"]')).toBeEnabled({ timeout: 30_000 });
  await page.locator('[data-ipad-drawer-tab="crop"]').click(); await page.locator('[data-dock-tool="crop"]').click();
  await page.locator('button', { hasText: /^2D$/ }).first().click().catch(() => {});
  await page.selectOption('#crop-size', '128');
  await expect(page.locator('#crop-mode')).toHaveAttribute('data-state', 'copy');
  await expect(page.locator('#crop-mode')).toContainText('元の値のまま');
  await expect(page.locator('#crop-straight')).toBeDisabled();
  await expect(page.locator('#crop-interp')).toBeHidden(); // the interpolation choice only exists when rotated
  await expect(page.locator('input#crop-rot-z[type=range]')).toHaveCount(0); // no rotation sliders any more
  const cv = page.locator('#axial-canvas');
  await expect(cv).toBeVisible();
  await page.waitForTimeout(800);
  // screen position of the axial plane coordinates (u, v) (voxel centres; the canvas is the image)
  const toScreen = async (u, v) => { const r = await cv.boundingBox(); return { x: r.x + (u + 0.5) / W2 * r.width, y: r.y + (v + 0.5) / H2 * r.height, r }; };
  const c0 = (W2 - 1) / 2, half = 64;
  const readZ = async () => +(await page.locator('#crop-rot-z').inputValue());
  // current corner (box corner -135 degrees, in the tilted frame) and the point 12 px outside it, for a box turned by z degrees
  const cornerOutside = async z => {
    const a = (z - 135) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), r = Math.hypot(half, half);
    const p = await toScreen(c0 + ux * r, c0 + uy * r), px = 12;
    return { x: p.x + ux * px, y: p.y + uy * px, r: p.r };
  };
  const centre = async () => toScreen(c0, c0);
  // drag: pointer goes round the box centre by deg degrees (screen clockwise = positive), starting just outside the corner
  const dragRotate = async (z, deg, { shift = false } = {}) => {
    const s = await cornerOutside(z), c = await centre(), R = Math.hypot(s.x - c.x, s.y - c.y), a0 = Math.atan2(s.y - c.y, s.x - c.x);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(s.x, s.y); await page.mouse.down();
    const steps = Math.max(4, Math.ceil(Math.abs(deg) / 6));
    for (let n = 1; n <= steps; n++) { const a = a0 + deg * Math.PI / 180 * n / steps; await page.mouse.move(c.x + R * Math.cos(a), c.y + R * Math.sin(a)); }
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  // hover feedback: inside = move cursor, next to a corner = rotate zone (cursor + drawn icon), far away = nothing
  const centreP = await centre(), outP = await cornerOutside(0);
  await page.mouse.move(centreP.x, centreP.y);
  await expect.poll(() => cv.evaluate(e => e.style.cursor)).toBe('move');
  await page.mouse.move(outP.x, outP.y);
  await expect.poll(() => cv.evaluate(e => e.style.cursor)).toBe('grab');
  await page.mouse.move(centreP.r.x + 3, centreP.r.y + 3);
  await expect.poll(() => cv.evaluate(e => e.style.cursor)).toBe('');
  // 1. a Shift drag in the rotate zone turns the box (snapped to 15 degrees) and the indicator says interpolated
  await dragRotate(0, 37, { shift: true });
  await expect(page.locator('#crop-mode')).toHaveAttribute('data-state', 'resample');
  await expect(page.locator('#crop-mode')).toContainText('補間あり');
  await expect(page.locator('#crop-interp')).toBeVisible();
  let z = await readZ(); expect(Math.abs(z)).toBeGreaterThan(10); expect(Math.abs(z) % 15).toBeCloseTo(0, 5);
  expect(Math.sign(z)).toBe(1); // clockwise on screen
  await expect(page.locator('#crop-straight')).toBeEnabled();
  // 2. a plain drag turns in whole degrees (1 degree steps)
  z = await readZ(); await dragRotate(z, 7.2);
  const z1 = await readZ(); expect(Math.abs(z1 - z - 7)).toBeLessThanOrEqual(1); expect(Number.isInteger(z1)).toBe(true);
  // 3. more Shift rotations, then a plain drag back to about 0 (0.3 degrees short): whole degrees land on exactly 0
  for (const d of [52, -70]) { z = await readZ(); await dragRotate(z, d, { shift: true }); }
  z = await readZ(); expect(Math.abs(z)).toBeGreaterThan(0);
  await dragRotate(z, -z + 0.3);
  await expect(page.locator('#crop-mode')).toHaveAttribute('data-state', 'copy');
  await expect(page.locator('#crop-mode')).toContainText('元の値のまま');
  expect(await readZ()).toBe(0); await expect(page.locator('#crop-interp')).toBeHidden();
  // 4. export: not resampled, bit-identical to the source sub-block (centre 127.5 -> start voxel (64, 64, -40), outside the series = fill 0)
  const r = await exportZip(page);
  expect(r.keys.length).toBe(128);
  const d0 = parse(r.files[r.keys[0]]).ds;
  expect(d0.string('x0008103e')).toBe('Test CT crop 128 (not resampled)');
  let bad = 0;
  r.keys.forEach((key, c) => {
    const { px } = parse(r.files[key]);
    for (let b = 0; b < 128; b++) for (let a = 0; a < 128; a++) {
      const i = a + 64, j = b + 64, k = c - 40, inside = k >= 0 && k < D2 && i < W2 && j < H2;
      if (px[b * 128 + a] !== (inside ? valueAt(i, j, k) : 0)) bad++;
    }
  });
  expect(bad, 'voxels that differ from the source').toBe(0);
  // 5. a plain rotate drag + the reset button: back to straight in one click, same exact copy path
  await dragRotate(0, 45);
  await expect(page.locator('#crop-mode')).toHaveAttribute('data-state', 'resample');
  await page.locator('#crop-straight').click();
  await expect(page.locator('#crop-mode')).toHaveAttribute('data-state', 'copy');
  expect(errors).toEqual([]);
});

test('crop export: no rotate handles when rotation is blocked, the move zone still works', async ({ page }) => {
  test.setTimeout(120_000);
  // a series without ImagePositionPatient / orientation tags cannot be rotated: strip nothing, but use a gantry-less set whose spacing check fails (a missing slice)
  const set = makeSet(160, 160, 40); const keep = set.names.map((_, i) => i).filter(i => i !== 20);
  await openSample(page, { ...set, names: keep.map(i => set.names[i]), slices: keep.map(i => set.slices[i]) });
  await expect(page.locator('[data-dock-tool="crop"]')).toBeEnabled({ timeout: 30_000 });
  await page.locator('[data-ipad-drawer-tab="crop"]').click(); await page.locator('[data-dock-tool="crop"]').click();
  await page.locator('button', { hasText: /^2D$/ }).first().click().catch(() => {});
  await page.selectOption('#crop-size', '128');
  await page.waitForTimeout(800);
  const cv = page.locator('#axial-canvas'), r = await cv.boundingBox();
  const at = (u, v) => ({ x: r.x + (u + 0.5) / 160 * r.width, y: r.y + (v + 0.5) / 160 * r.height });
  const c = at(79.5, 79.5), out = at(79.5 - 64 - 6, 79.5 - 64 - 6); // just outside the top-left corner
  await expect(page.locator('#crop-rot-z')).toBeDisabled();
  await page.mouse.move(out.x, out.y);
  await page.waitForTimeout(150);
  expect(await cv.evaluate(e => e.style.cursor)).toBe('');
  await page.mouse.move(c.x, c.y);
  await expect.poll(() => cv.evaluate(e => e.style.cursor)).toBe('move');
  await page.mouse.down(); await page.mouse.move(c.x + 20, c.y + 10, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#crop-pos-x')).not.toHaveValue('79.5');
  await expect(page.locator('#crop-mode')).toHaveAttribute('data-state', 'copy');
});
