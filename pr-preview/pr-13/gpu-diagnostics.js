// GPU diagnostics: the data of the debug-only 「GPU情報」 tab and its copyable report. No DOM and no GPU access (its only imports are the
// pure gpu-preference.js / gpu-split.js), so unit tests load it as is. gpu-diagnostics-ui.js gathers the values from gpuFilterRuntime and passes them
// in as plain data; this module only formats them (and keeps a small in-memory error log).
// The tab is shown, and anything that probes the GPU runs, only in debug mode (settings > デバッグ, or ?debug).

import { gpuPlatformOs } from './gpu-preference.js?v=20261026-build673';
import { gpuVendorKey, gpuAdapterVendorKey } from './gpu-split.js?v=20261026-build673';
// ---- visibility ----------------------------------------------------------------------------------------------------
// The one rule: the GPU info tab (and the status-bar click that opens it) exists only while debug mode is on, on every
// platform (Mac, iPad, Windows, Linux, Android alike). `nav` is accepted so a test can state "any platform" explicitly.
export function gpuDiagnosticsVisible(debugOn, nav = globalThis.navigator) { void nav; return debugOn === true; }

// ---- in-memory error log -------------------------------------------------------------------------------------------
// WebGPU failures (device request, device lost, uncaptured error, renderer init, ...) are appended here as they happen, so a
// report opened later still shows them. It is only an array of strings (40 entries at most): no UI, no GPU access.
const GPU_LOG_MAX = 40;
const gpuLog = [];
export function logGpuError(source, error) {
  try {
    const e = error;
    const message = String(e?.message ?? e?.reason ?? e ?? '');
    const stack = typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 8).join('\n') : '';
    gpuLog.push({ time: new Date().toISOString(), source: String(source), message: message.slice(0, 800), stack });
    while (gpuLog.length > GPU_LOG_MAX) gpuLog.shift();
  } catch {}
}
export const getGpuErrorLog = () => gpuLog.slice();
export const clearGpuErrorLog = () => { gpuLog.length = 0; };

// ---- hints ---------------------------------------------------------------------------------------------------------
// navigator.gpu exists on Linux but no requestAdapter option set returned an adapter: the browser itself keeps WebGPU off for
// this GPU (the launch-option note of linux-webgpu-note.js is the matching user-facing explanation). Not classified elsewhere.
export function gpuBrowserDisabled(d) { return !!(d && d.navigatorGpu && d.os === 'linux' && !d.adapter && !d.device); }

// Hint for adapters that look integrated / software ('' when it looks discrete or unknown)
export function gpuAdapterKind(info) {
  if (!info) return '';
  const t = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ').toLowerCase();
  if (!t) return '';
  if (/swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/.test(t)) return 'software';
  if (/intel|\bgen-?\d|xe-?lp|uhd|iris/.test(t) && !/arc\b|nvidia|amd|radeon|geforce/.test(t)) return 'integrated';
  return '';
}
// Honest note when the high-performance GPU was asked for but an integrated / software one was obtained
export function gpuPreferenceNote(preference, info) {
  const kind = gpuAdapterKind(info);
  return preference === 'high-performance' && kind ? kind : '';
}

// ---- report text ---------------------------------------------------------------------------------------------------
const val = v => (v === undefined || v === null || v === '' ? '-' : String(v));
const clip = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const list = a => (Array.isArray(a) && a.length ? a.join(', ') : '');

// Short WebGL renderer for the one-line summary: drops the ANGLE( ) wrapper, trailing API / driver parts and vendor noise.
export function gpuWebglShort(w, n = 24) {
  if (!w) return '';
  let r = String(w.renderer || '').trim();
  const m = r.match(/^ANGLE \((.*)\)$/); if (m) r = m[1];
  const parts = r.split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length > 1) r = parts[1].length > 3 ? parts[1] : parts[0];
  r = r.replace(/\b(NVIDIA Corporation|NVIDIA|Intel\(R\)|AMD|Corporation|Graphics|Mesa)\b/gi, ' ').replace(/\s*\(0x[0-9a-f]+\)/gi, '').replace(/\s+/g, ' ').trim();
  return clip(r || w.renderer || (w.version ? w.version : ''), n);
}

// One line of essentials (no UA), first in the report, so a paste that gets truncated still keeps the key facts. Always < 180 chars:
//   GPU要約 bNNN | WebGPU:有 | 要求:auto | 取得:<vendor> <device> fallback:no | WebGL:<renderer> | 直近エラー:なし
export function buildGpuSummary(data) {
  const r = data.requested || {}, a = data.adapter, i = a?.info || {};
  const dev = clip(i.device || i.description || i.architecture, 32);
  const got = a ? (clip(i.vendor, 14) || '-') + (dev ? ' ' + dev : '') + ' fallback:' + (a.isFallback === undefined ? '?' : a.isFallback ? 'yes' : 'no') : (gpuBrowserDisabled(data) ? 'なし(ブラウザ側で無効)' : 'なし');
  const w = data.webgl, gl = w ? ' | WebGL:' + (gpuWebglShort(w) || (w.error ? '取得不可' : '-')) : '';
  const err = data.lastError ? clip(data.lastError, w ? 30 : 40) : 'なし';
  return ('GPU要約 b' + clip(data.build ?? '-', 8) + ' | WebGPU:' + (data.navigatorGpu ? '有' : '無') + ' | 要求:' + clip(r.effective || '-', 16) + ' | 取得:' + got + gl + ' | 直近エラー:' + err).slice(0, 179);
}

// data: see collectGpuDiagnostics() in gpu-diagnostics-ui.js. t: key -> label. Returns plain text.
export function buildGpuReport(data, t = k => k) {
  const L = [buildGpuSummary(data)], add = (k, v) => L.push(t(k) + ': ' + val(v)), head = k => L.push('', '== ' + t(k) + ' ==');
  const yn = v => (v === undefined || v === null ? '-' : v ? t('gpuYes') : t('gpuNo'));
  L.push('Virtual Rodent Lab - ' + t('gpuReportTitle'));
  add('gpuRepTime', data.time || new Date().toISOString());
  add('gpuRepBuild', data.build);
  add('gpuRepUa', data.userAgent);
  add('gpuRepPlatform', data.platform + (data.os ? ' (' + data.os + ')' : ''));
  add('gpuRepDebug', yn(data.debug));
  add('gpuRepAvail', yn(data.navigatorGpu));
  add('gpuRepForceCompat', yn(data.forceCompat));

  // --- the adapter the compute device is on, and what was asked for
  head('gpuRepSecCompute');
  const r = data.requested || {};
  add('gpuRepPrefStored', r.stored);
  add('gpuRepPrefEffective', r.effective);
  add('gpuRepPrefSupported', yn(r.supported));
  add('gpuRepPrefOption', r.option === undefined ? '-' : (r.option ? JSON.stringify(r.option) : '(no options)') + (r.optionIndex >= 0 ? ' #' + (r.optionIndex + 1) : ''));
  add('gpuRepPrefInfo', data.prefInfo);
  const a = data.adapter;
  if (a) {
    const i = a.info || {};
    add('gpuRepAdapterSource', data.adapterSource);
    add('gpuRepVendor', i.vendor); add('gpuRepArch', i.architecture); add('gpuRepDevice', i.device); add('gpuRepDesc', i.description);
    add('gpuRepFallback', a.isFallback === undefined ? '-' : yn(a.isFallback));
    const lim = a.limits || {};
    add('gpuRepLimits', Object.keys(lim).map(k => k + '=' + lim[k]).join(', '));
    add('gpuRepFeatures', list(a.features));
  } else add('gpuRepAdapter', t('gpuNone'));
  const dv = data.device;
  if (dv) {
    add('gpuRepDeviceLimits', Object.keys(dv.limits || {}).map(k => k + '=' + dv.limits[k]).join(', '));
    add('gpuRepDeviceFeatures', list(dv.features));
  }
  add('gpuRepBackend', data.backend);
  add('gpuRepMode', data.mode);
  add('gpuRepWorkgroup', data.workgroupSize);
  add('gpuRepInitAttempts', data.initAttempts);
  add('gpuRepSharedDevice', yn(data.sharedRendererDevice));

  // --- buffer-limit ladder (4 GiB -> 2 GiB -> 1 GiB -> defaults), compute and render device
  head('gpuRepSecLadder');
  const ld = data.ladder || {};
  add('gpuRepLadderCaps', list(ld.caps));
  for (const [name, x] of [['gpuRepLadderCompute', ld.compute], ['gpuRepLadderRender', ld.render]]) {
    if (!x) continue;
    add(name, (x.info || '-') + ' | ' + t('gpuRepLadderRetries') + ' ' + (x.retries?.length || 0) + (x.cap ? ' | ' + t('gpuRepLadderCap') + ' ' + x.cap : ''));
    for (const s of x.retries || []) L.push('  - ' + s);
  }

  // --- hybrid (Intel display + NVIDIA) detection and the two devices
  head('gpuRepSecHybrid');
  const h = data.hybrid || {};
  add('gpuRepHybridStored', h.stored);
  add('gpuRepHybridEffective', h.effective);
  add('gpuRepHybridMode', h.mode);
  add('gpuRepHybridSeen', yn(h.seen));
  add('gpuRepHybridVendor', h.vendor);
  const sp = h.split;
  add('gpuRepSplit', sp ? 'active · render ' + val(sp.renderVendor) + ' · compute ' + val(sp.computeVendor) + (sp.reason ? ' · ' + sp.reason : '') : t('gpuNo'));
  add('gpuRepSplitNote', h.note);
  add('gpuRepVendorKeys', 'compute ' + val(h.computeVendorKey) + ' · display(WebGL) ' + val(h.displayVendorKey));
  const rd = data.render;
  if (rd) {
    add('gpuRepRenderDevice', rd.present ? t('gpuYes') + (rd.mode ? ' (' + rd.mode + ')' : '') : t('gpuNo'));
    add('gpuRepRenderAdapter', rd.adapterLabel);
    add('gpuRepRenderRequest', rd.request ? val(rd.request.effective) + (rd.request.option === undefined ? '' : ' ' + (rd.request.option ? JSON.stringify(rd.request.option) : '(no options)') + (rd.request.optionIndex >= 0 ? ' #' + (rd.request.optionIndex + 1) : '')) : '-');
    add('gpuRepRenderInfo', rd.info);
    if (rd.limits) add('gpuRepRenderLimits', Object.keys(rd.limits).map(k => k + '=' + rd.limits[k]).join(', '));
    add('gpuRepRenderError', rd.error);
  }

  // --- WebGL
  const w = data.webgl;
  if (w) {
    head('gpuRepSecWebgl');
    if (w.error && !w.version) add('gpuRepWebgl', w.error);
    else {
      add('gpuRepWebgl', w.version); add('gpuRepWebglVendor', w.vendor); add('gpuRepWebglRenderer', w.renderer);
      add('gpuRepWebgl2', yn(w.webgl2)); add('gpuRepWebglMax3d', w.max3dTextureSize);
      add('gpuRepWebglCbf', yn(w.extColorBufferFloat)); add('gpuRepWebglTfl', yn(w.oesTextureFloatLinear));
      add('gpuRepWebglExt', list(w.extensions));
    }
  }

  // --- linux-webgpu-note.js (the Chrome launch-option note under the status bar)
  const ln = data.linuxNote;
  if (ln) { head('gpuRepSecNote'); add('gpuRepNoteLinux', yn(ln.linux)); add('gpuRepNoteProbe', ln.probed === null ? t('gpuRepNoteNotProbed') : ln.probed === 'pending' ? t('gpuRepNotePending') : ln.probed ? t('gpuRepNoteNoAdapter') : t('gpuRepNoteAdapterOk')); add('gpuRepNoteShown', yn(ln.shown)); }

  // --- notes and errors (full text)
  head('gpuRepSecErrors');
  if (data.hint) add('gpuRepNote', data.hint);
  if (gpuBrowserDisabled(data)) add('gpuRepNote', t('gpuBrowserOff'));
  add('gpuRepLastError', data.lastError);
  add('gpuRepRenderErrorFull', data.renderError);
  add('gpuRepZeroTexture', data.zeroTexture);
  const errs = data.errors || [];
  L.push(t('gpuRepErrors') + ' (' + errs.length + '):');
  for (const e of errs) { L.push('  [' + e.time + '] ' + e.source + ': ' + e.message); if (e.stack) L.push(e.stack.split('\n').map(s => '    ' + s).join('\n')); }
  return L.join('\n');
}

// Throwaway WebGL context on an offscreen canvas (WebGL2, else WebGL1): vendor / renderer (UNMASKED when allowed), a few
// capabilities and the extension list, then the context is released. Debug tab only (see gpu-diagnostics-ui.js).
export function collectWebglInfo(doc = globalThis.document) {
  const out = { version: '', vendor: '', renderer: '', webgl2: false, max3dTextureSize: undefined, extColorBufferFloat: false, oesTextureFloatLinear: false, extensions: [], error: '' };
  let gl = null;
  try {
    const c = doc?.createElement?.('canvas'); if (!c) { out.error = 'no canvas'; return out; }
    c.width = c.height = 1;
    gl = c.getContext('webgl2'); if (gl) { out.webgl2 = true; out.version = 'WebGL2'; }
    else { gl = c.getContext('webgl') || c.getContext('experimental-webgl'); if (gl) out.version = 'WebGL1'; }
    if (!gl) { out.error = 'WebGL unavailable'; return out; }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.vendor = String((dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) ?? '');
    out.renderer = String((dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '');
    if (out.webgl2) { const v = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE); if (typeof v === 'number') out.max3dTextureSize = v; }
    out.extColorBufferFloat = !!gl.getExtension('EXT_color_buffer_float');
    out.oesTextureFloatLinear = !!gl.getExtension('OES_texture_float_linear');
    try { out.extensions = [...(gl.getSupportedExtensions?.() || [])].sort(); } catch {}
  } catch (e) { out.error = String(e?.message ?? e).slice(0, 120); }
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
  return out;
}

// ---- data collection -----------------------------------------------------------------------------------------------
// Gathers everything the report shows from the app's own state (gpuFilterRuntime etc.); no logic is repeated here. All inputs
// come in through `env` so a unit test can feed fakes: the DOM-bound wiring is gpu-diagnostics-collect.js.
//   env.rt                    gpuFilterRuntime            env.caps / env.forceCompat    GPU_BUFFER_LIMIT_CAPS / gpuForceCompat
//   env.stored / effective*   the settings and what the app honours (gpuPreference, gpuHybridMode)
//   env.probeAdapter()        optional, async: ONE requestAdapter pass, only called when the app never requested an adapter
//   env.webgl()               a throwaway WebGL context (collectWebglInfo)
//   env.linuxNote()           {linux, probed, shown} of linux-webgpu-note.js
// Only called from the debug tab (refresh / copy); never at start-up and never with debug off.
export const GPU_REPORT_LIMIT_KEYS = ['maxTextureDimension2D', 'maxTextureDimension3D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxStorageBuffersPerShaderStage'];
const pickLimits = l => { const o = {}; for (const k of GPU_REPORT_LIMIT_KEYS) { const v = l?.[k]; if (v !== undefined) o[k] = v; } return o; };
const featureList = f => { try { return [...(f || [])].map(String).sort(); } catch { return []; } };
const infoOf = obj => { try { const i = obj?.info || obj?.adapterInfo || {}; return { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description }; } catch { return {}; } };
const capText = c => (c > 0 ? Math.round(c / 2 ** 20) + 'MB' : 'default');
const requestRecord = r => (r ? { effective: r.effective, stored: r.stored, supported: r.supported, option: r.option, optionIndex: r.optionIndex } : null);

export async function gatherGpuDiagnostics(env) {
  const nav = env.nav || {}, rt = env.rt || {}, hasGpu = !!env.hasGpu;
  const tr = env.tr || (k => k);
  let adapter = rt.adapter || null, source = adapter ? 'compute adapter' : '', adapterData = null, req = rt.adapterRequest || null;
  if (!adapter && !rt.device && !rt.renderDevice && hasGpu && !req && !rt.renderAdapterRequest && env.probeAdapter) {
    // the app never asked for an adapter (start-up not reached yet): one pass, its record is not kept as the app's own
    try { const got = await env.probeAdapter(); adapter = got?.adapter || null; req = got?.request || null; if (adapter) source = 'probe'; } catch {}
  }
  if (adapter) adapterData = { info: infoOf(adapter), isFallback: adapter.isFallbackAdapter, limits: pickLimits(adapter.limits), features: featureList(adapter.features) };
  else if (rt.device) { adapterData = { info: infoOf(rt.device), isFallback: undefined, limits: pickLimits(rt.device.limits), features: featureList(rt.device.features) }; source = 'device (adapter object not kept)'; }
  const device = rt.device ? { limits: pickLimits(rt.device.limits), features: featureList(rt.device.features) } : null;
  const effective = req?.effective ?? (hasGpu ? env.effectivePreference : 'auto');
  const requested = { stored: String(env.stored?.gpuPreference ?? 'auto'), effective, supported: req?.supported ?? env.preferenceSupported, option: req?.option, optionIndex: req?.optionIndex ?? -1 };
  const os = env.os || gpuPlatformOs(nav);
  const webgl = env.webgl ? env.webgl() : null;
  const ladder = (arr, info, cap) => ({ info, retries: (arr || []).slice(), cap });
  const renderPresent = !!rt.renderDevice;
  const split = rt.split ? { active: !!rt.split.active, renderVendor: rt.split.renderVendor, computeVendor: rt.split.computeVendor, reason: rt.split.reason } : null;
  const hybrid = {
    stored: String(env.stored?.gpuHybridMode ?? 'hybrid'), effective: env.effectiveHybrid, mode: rt.hybridMode || '', seen: !!rt.hybridSeen, vendor: rt.hybridVendor || '', split,
    note: rt.splitNote || '', computeVendorKey: adapter ? gpuAdapterVendorKey(adapter) : '', displayVendorKey: webgl && (webgl.vendor || webgl.renderer) ? gpuVendorKey(webgl.vendor, webgl.renderer) : ''
  };
  const render = {
    present: renderPresent, mode: renderPresent && env.deviceMode ? env.deviceMode(rt.renderDevice) : '', adapterLabel: rt.renderAdapterLabel || '', request: requestRecord(rt.renderAdapterRequest),
    info: [rt.renderPrefInfo, rt.renderLimitInfo].filter(Boolean).join(' · '), limits: renderPresent ? pickLimits(rt.renderDevice.limits) : null, error: rt.renderError || ''
  };
  return {
    time: new Date().toISOString(), build: env.build, userAgent: nav.userAgent, platform: nav.userAgentData?.platform || nav.platform || '', os, debug: true,
    navigatorGpu: hasGpu, forceCompat: !!env.forceCompat, requested, prefInfo: rt.prefInfo || '', adapter: adapterData, adapterSource: source, device,
    backend: rt.lastBackend, mode: rt.device && env.deviceMode ? env.deviceMode(rt.device) : '', workgroupSize: rt.device ? rt.workgroupSize : undefined, initAttempts: rt.initAttempts, sharedRendererDevice: !!rt.sharedRendererDevice,
    ladder: { caps: (env.caps || []).map(capText), compute: ladder(rt.limitInfoLog, rt.limitInfo, rt.limitInfoCapUsed), render: renderPresent || rt.renderLimitInfo ? ladder(rt.renderLimitInfoLog, rt.renderLimitInfo, rt.renderLimitInfoCapUsed) : null },
    hybrid, render, webgl, linuxNote: env.linuxNote ? env.linuxNote() : null,
    errors: env.errors ? env.errors() : getGpuErrorLog(), lastError: rt.lastError || '', renderError: rt.renderError || '', zeroTexture: rt.zeroTexture || '',
    hint: adapterData && gpuPreferenceNote(effective, adapterData.info) ? tr('gpuPrefNote') : '', kind: adapterData ? gpuAdapterKind(adapterData.info) : ''
  };
}
