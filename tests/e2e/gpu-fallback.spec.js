import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// A GPU validation error (here: a boxMean kernel that never reads params, so the bind group
// dispatch() builds does not fit the 'auto' layout) must throw instead of returning zeros, must
// not leak the pooled work buffers or any scratch buffer, and must raise no uncaptured error.
// Needs a WebGPU adapter (software swiftshader is enough), so it only runs with RUN_GPU_E2E=1:
//   RUN_GPU_E2E=1 npx playwright test tests/e2e/gpu-fallback.spec.js
// (VRL_OFFLINE_CDN=1 serves three / fflate / dicom-parser from node_modules when the CDN is unreachable.)
test.skip(!process.env.RUN_GPU_E2E, 'set RUN_GPU_E2E=1 to run the WebGPU fallback test');
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'], executablePath: process.env.PW_CHROMIUM || undefined } });

const TAG = readFileSync('docs/gpu-compute.js', 'utf8').match(/mem-ledger\.js\?v=([^']+)/)[1];
const GOOD = "let wk=clamp(params[1]-f32(abs(k))+0.5,0.0,1.0);";

async function open(page, broken) {
  if (process.env.VRL_OFFLINE_CDN) {
    const map = u => u.includes('three.webgpu.js') ? 'node_modules/three/build/three.webgpu.js' : u.includes('three.module.js') ? 'node_modules/three/build/three.module.js' : u.includes('three.core.js') ? 'node_modules/three/build/three.core.js' : u.includes('dicom-parser') ? 'node_modules/dicom-parser/dist/dicomParser.min.js' : u.includes('fflate') ? 'node_modules/fflate/esm/browser.js' : null;
    await page.route(/^https:\/\//, route => {
      const u = route.request().url(), f = map(u);
      if (f) {
        let body = readFileSync(f, 'utf8');
        if (u.includes('dicom-parser')) body = 'const require=()=>({});const module={exports:{}};const exports=module.exports;\n' + body + '\nexport default (module.exports.default||module.exports||window.dicomParser);';
        return route.fulfill({ status: 200, contentType: 'text/javascript', body });
      }
      return route.abort();
    });
  }
  if (broken) {
    await page.route(/gpu-shaders\.js/, async route => {
      const body = await (await route.fetch()).text();
      expect(body).toContain(GOOD);
      await route.fulfill({ contentType: 'text/javascript', body: body.replace(GOOD, 'let wk=1.0;') });
    });
  }
  await page.goto('/');
  await page.waitForTimeout(1500);
}

const run = (page) => page.evaluate(async tag => {
  const m = await import('/gpu-compute.js?v=' + tag), led = await import('/mem-ledger.js?v=' + tag);
  const dev = await m.ensureGpuFilterDevice();
  if (!dev) return { noDevice: true };
  const uncaptured = []; dev.addEventListener('uncapturederror', e => uncaptured.push(String(e.error?.message).slice(0, 100)));
  const w = 16, h = 16, d = 8, n = w * h * d, data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = (i * 37 % 200) - 50;
  const target = { x: 0, y: 0, z: 0, width: w, height: h, depth: d };
  const stages = [{ key: 'unsharp', params: { radius: 1, amount: 1, thresholdHU: 0 } }], seg = [{ key: 's', seg: { min: -20, max: 60 } }];
  const calls = [
    () => m.runGpuSourceFilters(data, w, h, d, stages, target),
    () => m.runGpuSourceFilters(data, w, h, d, stages, target, seg),
    () => m.runGpuSourceFilters(data, w, h, d, stages, target, seg, { analysisRuns: true }),
    () => m.runGpuSourceFilters(data, w, h, d, stages, target, seg, { boxX: 0, boxY: 0, boxZ: 0, globalW: w, globalH: h, globalD: d, spacingX: 1, spacingY: 1, spacingZ: 1, mesh: true, gpuResident: false }),
  ];
  const once = async () => { const out = []; for (const c of calls) { try { const r = await c(); out.push('ok:' + (r.length ?? r.count ?? 'mesh')); } catch (e) { out.push('throw:' + String(e.message).slice(0, 60)); } } return out; };
  const first = await once();
  const snap = () => ({ pool: m.gpuFilterRuntime.bufferPoolBytes, buf: led.gpuLedger.bufBytes });
  const before = snap();
  for (let i = 0; i < 5; i++) await once();
  await new Promise(r => setTimeout(r, 500));
  return { first, before, after: snap(), uncaptured };
}, TAG);

test('normal kernels: every path succeeds, nothing uncaptured', async ({ page }) => {
  await open(page, false);
  const r = await run(page);
  test.skip(r.noDevice, 'no WebGPU adapter');
  expect(r.first.every(x => x.startsWith('ok:'))).toBe(true);
  expect(r.uncaptured).toEqual([]);
});

test('a validation error throws, leaks no buffer and raises no uncaptured error', async ({ page }) => {
  await open(page, true);
  const r = await run(page);
  test.skip(r.noDevice, 'no WebGPU adapter');
  for (const x of r.first) expect(x).toMatch(/^throw:dispatch boxMean: .*binding/s);
  expect(r.after).toEqual(r.before);
  expect(r.uncaptured).toEqual([]);
});
