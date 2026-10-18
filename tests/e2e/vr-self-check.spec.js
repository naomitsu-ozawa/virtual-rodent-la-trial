import { test, expect } from '@playwright/test';

// VR 自己診断: there is no headset in CI, so the real module (docs/vr-self-check.js) is driven by a fake XR frame loop (synthetic frame timestamps) in the
// browser, and the page-side result panel (shown after the VR session ends) is checked for the Japanese result lines, the verdict and the JSON.
test('self-check runs the scenarios on a fake frame loop and shows PASS / FAIL with numbers', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(async () => {
    const m = await import('/vr-self-check.js?e2e=1');
    const log = [];
    const q = { v: 0, clone() { return { v: this.v, copy(o) { this.v = o.v; } }; }, copy(o) { this.v = o.v; } };
    const zs = { mag: 1 };
    const env = { ready: () => '', begin: () => () => log.push('restore'), zoom: { info: () => ({ maxMag: 3.8, locked: false }), begin() { zs.sv = zs.mag; }, set(m) { zs.mag = m; }, end() { zs.mag = zs.sv; } }, holder: { quaternion: q, rotateY(a) { q.v += a; } },
      sectionSweep: { begin: () => ({ set() {} }), end() {} }, renderToggle: { begin() {}, set() {}, end() {} } };
    const sc = m.createVrSelfCheck({ ja: true, getTargetHz: () => 72, env, meta: { build: 'e2e' }, log: () => {} });
    const p = sc.start();
    let t = 5000, k = 0;
    while (sc.active && k < 20000) { t += 1000 / 72 + (k % 40 === 0 && sc.results.length === 1 ? 35 : 0); sc.tick(t); k++; await new Promise(r => setTimeout(r, 0)); } // the rotate scenario gets a hitch every 40th frame
    await p;
    const view = sc.view().lines.map(l => l.text);
    sc.dispose(); // what the VR cleanup does: the panel for the page
    const panel = document.getElementById('vr-selfcheck-panel');
    return { view, zmag: zs.mag, panel: panel?.innerText || '', json: panel?.querySelector('a')?.href || '', restored: log.at(-1), q: q.v };
  });
  expect(out.view.some(t => /^✔ 基準 72\.0fps（最低 72\.0, 最大 14ms）/.test(t))).toBe(true);
  expect(out.view.some(t => t.startsWith('✖ 回転'))).toBe(true);
  expect(out.view.at(-2)).toContain('総合：不合格');
  expect(out.panel).toContain('VR 自己診断 build e2e · 72 Hz'); expect(out.panel).toContain('✖ 回転'); expect(out.panel).toContain('コピー');
  expect(decodeURIComponent(out.json)).toContain('"kind": "vr-self-check"');
  expect(out.view.some(t => /^✔ 2倍 /.test(t))).toBe(true); expect(out.view.some(t => t.startsWith('－ 4倍（実施せず：最大 3.8倍まで）'))).toBe(true); expect(out.view.some(t => t.startsWith('✖ 拡大（回転中）：'))).toBe(false);
  expect(out.view.some(t => t.startsWith('✔ 拡大（静止）：'))).toBe(true); expect(out.panel).toContain('拡大（静止）'); expect(out.zmag).toBe(1);
  expect(out.view.some(t => /^✔ 2倍 .* · 直後 72\.0fps$/.test(t))).toBe(true); expect(decodeURIComponent(out.json)).toContain('"transition"'); // build 560: right after the change (not judged) + steady
  expect(out.restored).toBe('restore'); expect(out.q).toBe(0);
});
