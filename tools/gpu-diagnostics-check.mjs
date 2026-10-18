// GPU info tab check (build 520, debug mode only). Two page loads against docs/ (CDN imports mapped to node_modules, no network):
//   1. without ?debug: the tab is hidden, the status bar is not a button and a click on it opens nothing; and the page never makes an
//      extra WebGL context / requestAdapter call for diagnostics (counted through init scripts)
//   2. with ?debug: the status bar opens settings > GPU info, the report has the summary line and the new sections, copy works,
//      turning the debug switch off hides the tab again
// Run: PW_CHROMIUM=... node tools/gpu-diagnostics-check.mjs   (npm run gpu-diagnostics-check)
// Baseline: DOCS_ROOT=<an older docs/ copy> BASELINE_ONLY=1 prints the same start-up probe counts (debug off) for comparison.
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(process.env.DOCS_ROOT || 'docs'), nm = path.resolve('node_modules'); const errors = [];
const srv = http.createServer((q, r) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  // the practice data's bundled project is not applied (as in boot-check)
  if (p.endsWith('project.vrlab') && !process.env.SAMPLE_PROJECT) { r.writeHead(404); r.end(); return; }
  fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(b); });
}).listen(8766);
const map = u => {
  if (u.includes('three@0.186.0/build/three.module.js')) return nm + '/three/build/three.module.js';
  if (u.includes('three@0.186.0/build/three.webgpu.js')) return nm + '/three/build/three.webgpu.js';
  if (u.includes('three.core.js')) return nm + '/three/build/three.core.js';
  if (u.includes('dicom-parser')) return nm + '/dicom-parser/dist/dicomParser.min.js';
  if (u.includes('fflate')) return nm + '/fflate/esm/browser.js';
  return null;
};
const b = await chromium.launch({ args: process.env.NO_WEBGPU ? ['--disable-features=Vulkan', '--disable-webgpu'] : [], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
async function load(query) {
  const ctx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }); const pg = await ctx.newPage();
  // counts of the GPU probes the page makes (WebGL contexts created on a canvas, navigator.gpu.requestAdapter calls)
  await pg.addInitScript(() => {
    window.__probes = { webgl: 0, adapter: 0 };
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (k, ...a) { if (/webgl/.test(k)) window.__probes.webgl++; return gc.call(this, k, ...a); };
    try { const ra = navigator.gpu?.requestAdapter?.bind(navigator.gpu); if (ra) navigator.gpu.requestAdapter = (...a) => { window.__probes.adapter++; return ra(...a); }; } catch {}
  });
  pg.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('console.' + m.type() + ':', m.text().slice(0, 300)); });
  pg.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERROR:', String(e).slice(0, 500)); });
  await pg.route(/^https:\/\//, async rt => {
    const u = rt.request().url(), f = map(u);
    if (f) { let body = fs.readFileSync(f, 'utf8'); if (u.includes('dicom-parser')) body = 'const require=()=>({});const module={exports:{}};const exports=module.exports;\n' + body + '\nexport default (module.exports.default||module.exports||window.dicomParser);'; return rt.fulfill({ status: 200, contentType: 'text/javascript', body }); }
    if (u.includes('three-mesh-bvh') || u.includes('cornerstone')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};' });
    return rt.abort();
  });
  await pg.goto('http://localhost:8766/index.html' + query); await pg.waitForTimeout(4000);
  return { pg, ctx };
}

// ---- 1. debug off ----
if (process.env.BASELINE_ONLY) {
  const { pg, ctx } = await load('');
  console.log('startup probes (debug off):', JSON.stringify(await pg.evaluate(() => window.__probes)), '| bar:', await pg.evaluate(() => document.getElementById('gpu-status-bar').outerHTML.replace(/\s+/g, ' ')));
  await ctx.close(); await b.close(); srv.close(); process.exit(0);
}
{
  const { pg, ctx } = await load('');
  console.log('startup probes (debug off):', JSON.stringify(await pg.evaluate(() => window.__probes)), '| bar:', await pg.evaluate(() => document.getElementById('gpu-status-bar').outerHTML.replace(/\s+/g, ' ')));
  const barAttrs = await pg.evaluate(() => { const bar = document.getElementById('gpu-status-bar'); return { role: bar.getAttribute('role'), tabindex: bar.getAttribute('tabindex'), title: bar.getAttribute('title'), cls: bar.className, cursor: getComputedStyle(bar).cursor }; });
  ok(!barAttrs.role && barAttrs.tabindex === null && !/debug-link/.test(barAttrs.cls) && barAttrs.cursor !== 'pointer', 'debug off: status bar is not a button (' + JSON.stringify(barAttrs) + ')');
  ok(await pg.evaluate(() => { const t = document.querySelector('[data-settings-tab=gpu]'); return !!t && t.hidden && getComputedStyle(t).display === 'none'; }), 'debug off: GPU info tab is hidden');
  await pg.click('#gpu-status-bar'); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => !document.getElementById('settings-dialog').open), 'debug off: clicking the status bar opens nothing');
  const before = await pg.evaluate(() => ({ ...window.__probes }));
  await pg.click('#settings-open'); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => [...document.querySelectorAll('.settings-tab')].filter(t => t.offsetParent !== null).every(t => t.dataset.settingsTab !== 'gpu')), 'debug off: settings dialog shows no GPU info tab');
  ok(await pg.evaluate(() => document.getElementById('gpu-report').value === ''), 'debug off: no report was built');
  const after = await pg.evaluate(() => ({ ...window.__probes }));
  ok(after.webgl === before.webgl && after.adapter === before.adapter, 'debug off: opening settings makes no WebGL / requestAdapter call (' + JSON.stringify(after) + ')');
  // the switch in settings > デバッグ turns the tab on and off live
  await pg.click('[data-settings-tab=debug]'); await pg.check('#set-debug'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => !document.querySelector('[data-settings-tab=gpu]').hidden), 'debug switch on: tab appears');
  await pg.uncheck('#set-debug'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => document.querySelector('[data-settings-tab=gpu]').hidden && !document.getElementById('gpu-status-bar').getAttribute('role')), 'debug switch off: tab and status-bar link are gone again');
  await ctx.close();
}

// ---- 2. debug on ----
{
  const { pg, ctx } = await load('?debug');
  ok(await pg.evaluate(() => document.getElementById('gpu-status-bar').getAttribute('role') === 'button'), 'debug on: status bar is a button');
  await pg.click('#gpu-status-bar'); await pg.waitForTimeout(1200);
  ok(await pg.evaluate(() => document.getElementById('settings-dialog').open), 'debug on: status bar click opens settings');
  ok(await pg.evaluate(() => !document.querySelector('[data-settings-panel=gpu]').hidden), 'debug on: GPU info panel is shown');
  const rep = await pg.inputValue('#gpu-report'); console.log(rep.split('\n').slice(0, 40).join('\n'));
  ok(/^GPU要約 b\d+ \| WebGPU:/.test(rep), 'report starts with the summary line');
  ok(/navigator\.gpu: /.test(rep) && /User Agent: /.test(rep), 'report has navigator.gpu and UA');
  ok(/WebGPU|Compute|計算/.test(rep) && /== .*==/.test(rep), 'report has the new sections');
  await pg.click('#gpu-copy'); await pg.waitForTimeout(800);
  const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(clip.includes('User Agent'), 'copy button put the report on the clipboard');
  ok(/コピーしました|Copied|コピーできません|Could not copy/.test(await pg.textContent('#gpu-copy-msg')), 'copy message shown');
  console.log('status bar:', await pg.textContent('#gpu-status-text'));
  await ctx.close();
}
await b.close(); srv.close();
if (errors.length || fail) { console.error('gpu diagnostics check FAILED'); process.exit(1); }
console.log('gpu diagnostics check OK');
