import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { I18N } from '../../docs/i18n.js';
import {
  gpuDiagnosticsVisible, logGpuError, getGpuErrorLog, clearGpuErrorLog, buildGpuReport, buildGpuSummary, gpuPreferenceNote, gpuAdapterKind, gpuBrowserDisabled,
  gpuWebglShort, collectWebglInfo, gatherGpuDiagnostics, GPU_REPORT_LIMIT_KEYS
} from '../../docs/gpu-diagnostics.js';
import { initGpuDiagnosticsUi } from '../../docs/gpu-diagnostics-ui.js';

// build 520: the GPU info tab and its diagnostic report (PR #123's idea, ported onto the build 518 code) exist only in debug mode.
// gpu-diagnostics.js and gpu-diagnostics-ui.js import no GPU / DOM code, so they load here as they are; the DOM-bound wiring
// (gpu-diagnostics-collect.js) is checked from its source.
const read = p => readFileSync(p, 'utf8');
const UA = {
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
};
const NAV = Object.fromEntries(Object.entries(UA).map(([k, userAgent]) => [k, { userAgent, maxTouchPoints: k === 'ipad' || k === 'android' ? 5 : 0, gpu: {} }]));

describe('visibility: debug mode only, on every platform', () => {
  it('is hidden with debug off on Mac / iPad / Windows / Linux / Android', () => {
    for (const k of Object.keys(NAV)) {
      expect(gpuDiagnosticsVisible(false, NAV[k]), k).toBe(false);
      expect(gpuDiagnosticsVisible(undefined, NAV[k]), k).toBe(false);
    }
  });
  it('is shown with debug on, on every platform', () => {
    for (const k of Object.keys(NAV)) expect(gpuDiagnosticsVisible(true, NAV[k]), k).toBe(true);
  });
  it('only a real true turns it on', () => {
    for (const v of [0, '', null, 'false', 1, 'true']) expect(gpuDiagnosticsVisible(v)).toBe(false);
  });
});

describe('error log', () => {
  beforeEach(clearGpuErrorLog);
  it('records message and stack, capped', () => {
    logGpuError('requestDevice', new Error('boom'));
    logGpuError('x', 'plain string');
    const l = getGpuErrorLog();
    expect(l[0]).toMatchObject({ source: 'requestDevice', message: 'boom' });
    expect(l[0].stack).toContain('Error: boom');
    expect(l[1].message).toBe('plain string');
    for (let i = 0; i < 100; i++) logGpuError('s', i);
    expect(getGpuErrorLog().length).toBe(40);
    expect(getGpuErrorLog().at(-1).message).toBe('99');
  });
  it('never throws on odd values', () => { expect(() => { logGpuError('a', null); logGpuError('b', undefined); logGpuError('c', { get message() { throw new Error('x'); } }); }).not.toThrow(); });
});

const dev = (limits = {}) => ({ limits: { maxBufferSize: 4294967296, maxStorageBufferBindingSize: 4294967292, ...limits }, features: new Set(['core-features-and-limits', 'timestamp-query']) });
const nvidia = { info: { vendor: 'nvidia', architecture: 'ada', device: '', description: 'NVIDIA GeForce RTX 4070 Ti' }, isFallbackAdapter: false, limits: { maxBufferSize: 4294967296, maxTextureDimension3D: 2048 }, features: new Set(['core-features-and-limits']) };
const request = { stored: 'auto', effective: 'auto', supported: true, option: { powerPreference: 'high-performance', featureLevel: 'core' }, optionIndex: 0 };
const hybridRt = () => ({
  adapter: nvidia, device: dev(), lastBackend: 'WEBGPU CORE FULL VERIFIED · WG256', lastError: 'verify [gaussian]: ' + 'long text '.repeat(30), workgroupSize: 256, initAttempts: 1, sharedRendererDevice: false,
  adapterRequest: request, prefInfo: 'GPU pref auto → nvidia ada (request #1)', limitInfo: 'limits buf 2048MB/bind 2048MB (adapter 4096MB/4096MB) · retry 4096MB failed: VK_ERROR_OUT_OF_DEVICE_MEMORY',
  limitInfoLog: ['4096MB failed: VK_ERROR_OUT_OF_DEVICE_MEMORY'], limitInfoCapUsed: '2048MB',
  split: { active: true, renderVendor: 'intel', computeVendor: 'nvidia', reason: 'display intel, compute nvidia' }, hybridMode: 'hybrid', hybridSeen: true, splitNote: 'display intel, compute nvidia',
  renderDevice: dev({ maxBufferSize: 268435456 }), renderAdapterLabel: 'intel gen-12lp', renderAdapterRequest: { ...request, effective: 'low-power', option: { powerPreference: 'low-power', featureLevel: 'core' } },
  renderPrefInfo: 'GPU pref low-power → intel gen-12lp (request #1)', renderLimitInfo: 'limits buf 256MB/bind 128MB (adapter 256MB/128MB)', renderLimitInfoLog: [], renderLimitInfoCapUsed: '4096MB', renderError: ''
});
const webglOk = { version: 'WebGL2', vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 770 (ADL-S GT1), OpenGL ES 3.2)', webgl2: true, max3dTextureSize: 2048, extColorBufferFloat: true, oesTextureFloatLinear: true, extensions: ['EXT_color_buffer_float', 'OES_texture_float_linear'], error: '' };
const env = (over = {}) => ({
  nav: { userAgent: UA.linux, platform: 'Linux x86_64' }, hasGpu: true, rt: hybridRt(), caps: [4 * 1024 ** 3, 2 * 1024 ** 3, 1024 ** 3, 0], forceCompat: false, build: '520',
  stored: { gpuPreference: 'auto', gpuHybridMode: 'hybrid' }, effectivePreference: 'auto', effectiveHybrid: 'hybrid', preferenceSupported: true,
  deviceMode: d => (d?.features?.has?.('core-features-and-limits') ? 'CORE' : 'COMPAT'), webgl: () => webglOk, linuxNote: () => ({ linux: true, probed: false, shown: false }),
  errors: () => [{ time: 'T', source: 'requestDevice (cap 4096MB)', message: 'VK_ERROR_OUT_OF_DEVICE_MEMORY', stack: '' }], tr: k => k, ...over
});

describe('gatherGpuDiagnostics: reads the app state, no recomputation', () => {
  it('collects the ladder, preference, split / hybrid, render and compute devices and the full errors', async () => {
    const d = await gatherGpuDiagnostics(env());
    expect(d.requested).toMatchObject({ stored: 'auto', effective: 'auto', supported: true, optionIndex: 0 });
    expect(d.prefInfo).toContain('GPU pref auto');
    expect(d.adapter.info.vendor).toBe('nvidia'); expect(d.adapterSource).toBe('compute adapter');
    expect(d.device.limits.maxBufferSize).toBe(4294967296); expect(d.mode).toBe('CORE'); expect(d.workgroupSize).toBe(256);
    expect(d.ladder.caps).toEqual(['4096MB', '2048MB', '1024MB', 'default']);
    expect(d.ladder.compute).toMatchObject({ retries: ['4096MB failed: VK_ERROR_OUT_OF_DEVICE_MEMORY'], cap: '2048MB' });
    expect(d.ladder.render.info).toContain('256MB');
    expect(d.hybrid).toMatchObject({ mode: 'hybrid', seen: true, effective: 'hybrid', computeVendorKey: 'nvidia', displayVendorKey: 'intel', note: 'display intel, compute nvidia' });
    expect(d.hybrid.split).toMatchObject({ active: true, renderVendor: 'intel', computeVendor: 'nvidia' });
    expect(d.render).toMatchObject({ present: true, mode: 'CORE', adapterLabel: 'intel gen-12lp' });
    expect(d.render.request.effective).toBe('low-power'); expect(d.render.limits.maxBufferSize).toBe(268435456);
    expect(d.lastError.length).toBeGreaterThan(160);   // full text, not the status bar's cut
    expect(d.linuxNote).toEqual({ linux: true, probed: false, shown: false });
  });
  it('probes an adapter only when the app never requested one, and not when a device already exists', async () => {
    let probes = 0;
    const probeAdapter = async () => { probes++; return { adapter: nvidia, request }; };
    await gatherGpuDiagnostics(env());                                              // runtime has adapter + device
    await gatherGpuDiagnostics(env({ rt: { ...hybridRt(), adapter: null } }));      // adopted renderer device (Mac / iPad): device info is read from the device
    await gatherGpuDiagnostics(env({ rt: { adapter: null, device: null, adapterRequest: { ...request, optionIndex: -1 } } })); // asked, nothing came back
    await gatherGpuDiagnostics(env({ hasGpu: false, rt: {} }));
    expect(probes).toBe(0);
    const d = await gatherGpuDiagnostics(env({ rt: {}, probeAdapter }));            // never asked
    expect(probes).toBe(1); expect(d.adapterSource).toBe('probe'); expect(d.adapter.info.vendor).toBe('nvidia');
  });
  it('an adopted renderer device without an adapter object still shows vendor info from the device', async () => {
    const rt = { ...hybridRt(), adapter: null, device: { ...dev(), adapterInfo: { vendor: 'apple', architecture: 'metal-3' } } };
    const d = await gatherGpuDiagnostics(env({ rt, nav: { userAgent: UA.mac }, os: 'mac' }));
    expect(d.adapter.info.vendor).toBe('apple'); expect(d.adapterSource).toContain('device');
  });
  it('survives an empty runtime (WebGPU absent)', async () => {
    const d = await gatherGpuDiagnostics(env({ hasGpu: false, rt: { lastBackend: 'CPU' }, webgl: () => null, linuxNote: null }));
    expect(d.adapter).toBeNull(); expect(d.render.present).toBe(false);
    expect(() => buildGpuReport(d, k => k)).not.toThrow();
  });
});

describe('buildGpuReport', () => {
  const t = k => k;
  it('starts with the one-line summary (and nothing but the summary line before the title)', async () => {
    const d = await gatherGpuDiagnostics(env());
    const lines = buildGpuReport(d, t).split('\n');
    expect(lines[0]).toBe(buildGpuSummary(d));
    expect(lines[0]).toMatch(/^GPU要約 b520 \| WebGPU:有 \| 要求:auto \| 取得:nvidia NVIDIA GeForce RTX 4070 Ti fallback:no \| WebGL:.+ \| 直近エラー:.+/);
    expect(lines[0].length).toBeLessThan(180);
    expect(lines[0]).not.toContain('Mozilla');
  });
  it('contains the new fields: ladder, preference, split / hybrid, both devices, WebGL, full last error, Linux note', async () => {
    const d = await gatherGpuDiagnostics(env());
    const r = buildGpuReport(d, t);
    for (const s of [
      'gpuRepLadderCaps: 4096MB, 2048MB, 1024MB, default', 'gpuRepLadderCompute: limits buf 2048MB', 'gpuRepLadderRetries 1', 'gpuRepLadderCap 2048MB', '  - 4096MB failed: VK_ERROR_OUT_OF_DEVICE_MEMORY', 'gpuRepLadderRender: limits buf 256MB',
      'gpuRepPrefStored: auto', 'gpuRepPrefEffective: auto', 'gpuRepPrefOption: {"powerPreference":"high-performance","featureLevel":"core"} #1', 'gpuRepPrefInfo: GPU pref auto → nvidia ada',
      'gpuRepHybridMode: hybrid', 'gpuRepHybridSeen: gpuYes', 'gpuRepSplit: active · render intel · compute nvidia · display intel, compute nvidia', 'gpuRepSplitNote: display intel, compute nvidia', 'gpuRepVendorKeys: compute nvidia · display(WebGL) intel',
      'gpuRepRenderDevice: gpuYes (CORE)', 'gpuRepRenderAdapter: intel gen-12lp', 'gpuRepRenderRequest: low-power', 'gpuRepRenderLimits: maxBufferSize=268435456',
      'gpuRepDeviceLimits: maxBufferSize=4294967296', 'gpuRepWebglRenderer: ANGLE (Intel', 'gpuRepWebglMax3d: 2048', 'gpuRepWebglExt: EXT_color_buffer_float, OES_texture_float_linear',
      'gpuRepNoteLinux: gpuYes', 'gpuRepNoteProbe: gpuRepNoteAdapterOk', 'gpuRepNoteShown: gpuNo', 'gpuRepBackend: WEBGPU CORE FULL VERIFIED · WG256', 'gpuRepMode: CORE',
      '[T] requestDevice (cap 4096MB): VK_ERROR_OUT_OF_DEVICE_MEMORY'
    ]) expect(r, s).toContain(s);
    expect(r).toContain('long text '.repeat(30).trim());   // the full last error
    expect(r).not.toMatch(/chrome:\/\//i);
  });
  it('shows the Linux note status for each probe state', async () => {
    const f = async ln => buildGpuReport(await gatherGpuDiagnostics(env({ linuxNote: () => ln })), t);
    expect(await f({ linux: true, probed: null, shown: false })).toContain('gpuRepNoteProbe: gpuRepNoteNotProbed');
    expect(await f({ linux: true, probed: 'pending', shown: false })).toContain('gpuRepNoteProbe: gpuRepNotePending');
    expect(await f({ linux: true, probed: true, shown: true })).toContain('gpuRepNoteProbe: gpuRepNoteNoAdapter');
  });
  it('works with no adapter and no gpu', () => {
    const r = buildGpuReport({ navigatorGpu: false, requested: {}, adapter: null, errors: [] }, t);
    expect(r).toContain('gpuRepAvail: gpuNo');
    expect(r).toContain('gpuRepAdapter: gpuNone');
  });
  it('summary covers no-adapter / no-gpu and long values', () => {
    const s = buildGpuSummary({ navigatorGpu: false, requested: {}, adapter: null, errors: [] });
    expect(s).toContain('WebGPU:無'); expect(s).toContain('取得:なし'); expect(s).toContain('直近エラー:なし');
    const long = 'x'.repeat(500);
    const l = buildGpuSummary({ build: long, lastError: long, navigatorGpu: true, requested: { effective: long }, adapter: { info: { vendor: long, device: long }, isFallback: true }, webgl: { renderer: long } });
    expect(l.length).toBeLessThan(180); expect(l).toContain('fallback:yes');
  });
  it('every label the report uses exists in ja and en', async () => {
    const used = new Set(), spy = k => { used.add(k); return k; };
    buildGpuReport(await gatherGpuDiagnostics(env()), spy);
    buildGpuReport(await gatherGpuDiagnostics(env({ hasGpu: false, rt: {}, linuxNote: () => ({ linux: true, probed: true, shown: true }) })), spy);
    buildGpuReport({ navigatorGpu: true, os: 'linux', adapter: null, requested: {}, hint: 'h', webgl: { error: 'x' } }, spy);
    expect(used.size).toBeGreaterThan(50);
    for (const l of ['ja', 'en']) for (const k of used) expect(I18N[l][k], l + ':' + k).toBeTruthy();
    for (const l of ['ja', 'en']) for (const k of ['settingsTabGpu', 'gpuCopy', 'gpuCopied', 'gpuCopyManual', 'gpuTabNote', 'gpuHintSw', 'gpuHintInt', 'gpuPrefNote', 'gpuBrowserOff']) expect(I18N[l][k], l + ':' + k).toBeTruthy();
  });
  it('lists the limit keys it reports', () => { expect(GPU_REPORT_LIMIT_KEYS).toContain('maxStorageBufferBindingSize'); });
});

describe('hints and WebGL', () => {
  it('flags high-performance requests that got integrated / software GPUs', () => {
    expect(gpuPreferenceNote('high-performance', { vendor: 'intel', architecture: 'gen-12lp' })).toBe('integrated');
    expect(gpuPreferenceNote('high-performance', { vendor: 'nvidia' })).toBe('');
    expect(gpuPreferenceNote('auto', { vendor: 'intel', architecture: 'gen-12lp' })).toBe('');
    expect(gpuAdapterKind({ description: 'llvmpipe' })).toBe('software');
  });
  it('detects browser-disabled WebGPU only on Linux with navigator.gpu and no adapter', () => {
    expect(gpuBrowserDisabled({ navigatorGpu: true, os: 'linux', adapter: null })).toBe(true);
    expect(gpuBrowserDisabled({ navigatorGpu: false, os: 'linux', adapter: null })).toBe(false);
    for (const os of ['windows', 'mac', 'ios', 'android']) expect(gpuBrowserDisabled({ navigatorGpu: true, os, adapter: null })).toBe(false);
    expect(gpuBrowserDisabled({ navigatorGpu: true, os: 'linux', adapter: { info: {} } })).toBe(false);
    expect(buildGpuSummary({ navigatorGpu: true, os: 'linux', adapter: null, requested: {} })).toContain('取得:なし(ブラウザ側で無効)');
  });
  it('no chrome:// text in the user-facing sources', () => {
    for (const f of ['docs/i18n.js', 'docs/gpu-diagnostics.js', 'docs/gpu-diagnostics-ui.js', 'docs/gpu-diagnostics-collect.js']) expect(read(f), f).not.toMatch(/chrome:\/\//i);
  });
  it('shortens the WebGL renderer for the summary', () => {
    expect(gpuWebglShort(webglOk)).toContain('UHD');
    expect(gpuWebglShort(webglOk)).not.toContain('ANGLE');
    expect(gpuWebglShort(null)).toBe('');
  });
  it('collects from a mocked context, reads the extensions and loses it', () => {
    let lost = 0;
    const gl = { VENDOR: 1, RENDERER: 2, MAX_3D_TEXTURE_SIZE: 3, getParameter: p => ({ 10: 'V', 11: 'R', 3: 512 }[p]), getSupportedExtensions: () => ['B_ext', 'A_ext'],
      getExtension: n => n === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 10, UNMASKED_RENDERER_WEBGL: 11 } : n === 'EXT_color_buffer_float' ? {} : n === 'WEBGL_lose_context' ? { loseContext: () => { lost++; } } : null };
    const doc = { createElement: () => ({ getContext: k => (k === 'webgl2' ? gl : null) }) };
    expect(collectWebglInfo(doc)).toMatchObject({ version: 'WebGL2', vendor: 'V', renderer: 'R', webgl2: true, max3dTextureSize: 512, extColorBufferFloat: true, oesTextureFloatLinear: false, extensions: ['A_ext', 'B_ext'] });
    expect(lost).toBe(1);
    expect(collectWebglInfo({ createElement: () => ({ getContext: () => null }) }).error).toBeTruthy();
  });
});

// ---- the UI wiring, with a fake DOM ----
function fakeDom() {
  const mk = (id, extra = {}) => {
    const el = { id, hidden: false, value: '', textContent: '', attrs: {}, listeners: {}, classes: new Set(), style: {}, tabIndex: -1, onclick: null, clicks: 0, ...extra };
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); }; el.removeAttribute = k => { delete el.attrs[k]; if (k === 'tabindex') el.tabIndex = -1; };
    el.classList = { add: c => el.classes.add(c), remove: c => el.classes.delete(c), contains: c => el.classes.has(c), toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)) };
    el.addEventListener = (t, f) => { (el.listeners[t] ||= []).push(f); };
    el.click = () => { el.clicks++; el.onclick?.(); (el.listeners.click || []).forEach(f => f({})); };
    el.focus = () => {}; el.select = () => {};
    return el;
  };
  const gpuTab = mk('tab-gpu', { hidden: true }), renderTab = mk('tab-render'), gpuPanel = mk('panel-gpu', { hidden: true });
  renderTab.classes.add('is-active');
  gpuTab.addEventListener('click', () => { renderTab.classes.delete('is-active'); gpuTab.classes.add('is-active'); gpuPanel.hidden = false; });
  renderTab.addEventListener('click', () => { gpuTab.classes.delete('is-active'); renderTab.classes.add('is-active'); gpuPanel.hidden = true; });
  const dlg = mk('settings-dialog', { open: false, querySelector: s => (s === '[data-settings-tab="gpu"]' ? gpuTab : s === '[data-settings-panel="gpu"]' ? gpuPanel : s === '[data-settings-tab="render"]' ? renderTab : null) });
  const open = mk('settings-open'); open.onclick = () => { dlg.open = true; };
  const els = { 'settings-dialog': dlg, 'settings-open': open, 'gpu-hint': mk('gpu-hint', { hidden: true }), 'gpu-report': mk('gpu-report'), 'gpu-copy-msg': mk('gpu-copy-msg'), 'gpu-copy': mk('gpu-copy'), 'gpu-status-bar': mk('gpu-status-bar') };
  return { doc: { getElementById: id => els[id] || null, execCommand: () => false }, els, gpuTab, gpuPanel, renderTab, dlg };
}
const fakeEvents = () => { const l = []; return { addEventListener: (t, f) => { if (t === 'vrl-settings') l.push(f); }, fire: detail => l.forEach(f => f({ detail })), count: () => l.length }; };
const collectData = async () => ({ ...(await gatherGpuDiagnostics(env())) });

describe('GPU info tab wiring (debug mode only)', () => {
  it('debug off: tab and panel stay hidden, the status bar is untouched, collect is never called', async () => {
    const t = fakeDom(); let collects = 0, debug = false; const ev = fakeEvents();
    const ui = initGpuDiagnosticsUi({ doc: t.doc, collect: async () => { collects++; return collectData(); }, isDebug: () => debug, events: ev });
    const bar = t.els['gpu-status-bar'];
    expect(t.gpuTab.hidden).toBe(true); expect(t.gpuPanel.hidden).toBe(true);
    expect(bar.attrs).toEqual({}); expect(bar.tabIndex).toBe(-1); expect(bar.classes.size).toBe(0); expect(bar.listeners.click).toBeUndefined(); expect(bar.listeners.keydown).toBeUndefined();
    // everything that could reach the GPU does nothing
    bar.click(); await ui.refresh(); ui.open(); t.els['gpu-copy'].click(); t.gpuTab.click();
    await new Promise(r => setTimeout(r, 0));
    expect(collects).toBe(0); expect(t.dlg.open).toBe(false); expect(t.els['gpu-report'].value).toBe('');
  });
  it('debug on from the start (?debug): tab shown, status bar opens it, report is filled', async () => {
    const t = fakeDom(); let collects = 0;
    initGpuDiagnosticsUi({ doc: t.doc, collect: async () => { collects++; return collectData(); }, isDebug: () => true, events: fakeEvents() });
    const bar = t.els['gpu-status-bar'];
    expect(t.gpuTab.hidden).toBe(false); expect(bar.attrs.role).toBe('button'); expect(bar.tabIndex).toBe(0); expect(bar.classes.has('is-debug-link')).toBe(true);
    expect(collects).toBe(0);                                   // nothing is collected until the tab is opened
    bar.click(); await new Promise(r => setTimeout(r, 0));
    expect(t.dlg.open).toBe(true); expect(t.gpuTab.classes.has('is-active')).toBe(true); expect(collects).toBe(1);
    expect(t.els['gpu-report'].value.split('\n')[0]).toMatch(/^GPU要約 b520 /);
  });
  it('toggling the debug switch shows and hides the tab live; a visible GPU tab falls back to the first tab', async () => {
    const t = fakeDom(); let debug = false, collects = 0; const ev = fakeEvents();
    initGpuDiagnosticsUi({ doc: t.doc, collect: async () => { collects++; return collectData(); }, isDebug: () => debug, events: ev });
    const bar = t.els['gpu-status-bar'];
    debug = true; ev.fire({ key: 'debug', value: true });
    expect(t.gpuTab.hidden).toBe(false); expect(bar.attrs.role).toBe('button');
    t.gpuTab.click(); await new Promise(r => setTimeout(r, 0)); expect(t.gpuTab.classes.has('is-active')).toBe(true); expect(collects).toBe(1);
    debug = false; ev.fire({ key: 'debug', value: false });
    expect(t.gpuTab.hidden).toBe(true); expect(t.gpuPanel.hidden).toBe(true); expect(t.renderTab.classes.has('is-active')).toBe(true);
    expect(bar.attrs).toEqual({}); expect(bar.tabIndex).toBe(-1); expect(bar.classes.size).toBe(0);
    t.dlg.open = false; bar.click(); expect(t.dlg.open).toBe(false);          // the listener stays but does nothing
    ev.fire({ key: 'other' }); expect(t.gpuTab.hidden).toBe(true);
    expect(collects).toBe(1);
  });
  it('the copy button copies the report text (manual fallback when the clipboard is missing)', async () => {
    const t = fakeDom();
    initGpuDiagnosticsUi({ doc: t.doc, collect: collectData, isDebug: () => true, events: fakeEvents() });
    t.els['gpu-copy'].click(); await new Promise(r => setTimeout(r, 5));
    expect(t.els['gpu-report'].value).toContain('Virtual Rodent Lab');
    expect(t.els['gpu-copy-msg'].textContent).toBeTruthy();
  });
  it('returns null (and touches nothing) without the dialog or the collector', () => {
    expect(initGpuDiagnosticsUi({ doc: { getElementById: () => null }, collect: async () => ({}) })).toBeNull();
    expect(initGpuDiagnosticsUi({ doc: fakeDom().doc })).toBeNull();
  });
});

describe('nothing changes with debug off (source checks)', () => {
  const settingsUi = read('docs/settings-ui.js'), shell = read('docs/ui-shell.js'), css = read('docs/style.css'), collectSrc = read('docs/gpu-diagnostics-collect.js'), uiSrc = read('docs/gpu-diagnostics-ui.js');
  it('the tab button and panel are hidden in the markup', () => {
    expect(shell).toMatch(/data-settings-tab="gpu"[^>]*\bhidden>/);
    expect(shell).toMatch(/data-settings-panel="gpu" hidden>/);
  });
  it('the status bar gets no cursor / role in the stylesheet or the markup', () => {
    expect(css).not.toMatch(/\.gpu-status-bar\{cursor:pointer\}/);
    expect(css).toContain('.gpu-status-bar.is-debug-link{cursor:pointer}');
    expect(shell).not.toMatch(/id="gpu-status-bar"[^>]*(role|tabindex)/i);
  });
  it('collection (adapter probe / WebGL) is reached only through the injected collect() of the debug tab', () => {
    expect(settingsUi.match(/initGpuDiagnosticsUi\(/g)).toHaveLength(1);
    expect(settingsUi).toContain('collect:collectGpuDiagnostics');
    for (const f of ['docs/app.js', 'docs/gpu-compute.js', 'docs/scene-view.js', 'docs/linux-webgpu-note.js']) expect(read(f), f).not.toMatch(/gpu-diagnostics-collect|collectWebglInfo|collectGpuDiagnostics/);
    // every collect() call in the UI is behind the debug check
    expect(uiSrc.match(/await collect\(\)/g)).toHaveLength(1);
    expect(uiSrc).toMatch(/async function refresh\(\) \{\s*if \(!on\(\)\) return;/);
    expect(collectSrc).toContain("'probe'");
  });
  it('the app code only gains data records and in-memory log calls (no probes, no UI)', () => {
    const gpuSrc = read('docs/gpu-compute.js');
    expect(gpuSrc.match(/logGpuError\(/g)).toHaveLength(4);   // compute error, device-request retry, render uncaptured error, render device lost
    expect(gpuSrc).not.toMatch(/gpu-diagnostics-ui|gpu-diagnostics-collect/);
    expect(gpuSrc).toContain("role==='probe'?'probeAdapterRequest':'adapterRequest'");
  });
});
