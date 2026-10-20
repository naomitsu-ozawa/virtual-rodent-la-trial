import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { gpuVendorKey, gpuAdapterVendorKey, gpuSplitDecision, gpuSplitCandidate, gpuSplitStatusParts, gpuIsVolumeLabel, gpuHybridStatusText, gpuStatusDetailed, webglDisplayGpu } from '../../docs/gpu-split.js';
import { gpuPlatformOs, gpuEffectivePreference, gpuPreferenceSupported, gpuAdapterRequestOptions, gpuPreferenceInfoText, gpuEffectiveHybridMode, gpuHybridModeSupported } from '../../docs/gpu-preference.js';

const nav = (userAgent, platform, maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });
const LINUX = nav('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/155 Safari/537.36', 'Linux x86_64');
const WIN = nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155', 'Win32');
const MAC = nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/155', 'MacIntel');
const IPAD = nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 5);
const ANDROID = nav('Mozilla/5.0 (Linux; Android 14; Quest 3) Chrome/155 Mobile', 'Linux armv8l', 5);
const CROS = nav('Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) Chrome/155', 'Linux x86_64');

const NV_INFO = { vendor: 'nvidia', architecture: 'ada', device: '', description: 'NVIDIA GeForce RTX 4070 Ti' };
const INTEL_INFO = { vendor: 'intel', architecture: 'gen-12lp', device: '', description: 'Intel(R) UHD Graphics 770' };
const AMD_INFO = { vendor: 'amd', architecture: 'rdna-3', device: '', description: 'AMD Radeon RX 7800 XT' };
const APPLE_INFO = { vendor: 'apple', architecture: 'metal-3', device: '', description: '' };
const WEBGL_INTEL = { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 770 (ADL-S GT1), OpenGL 4.6)' };
const WEBGL_NV = { vendor: 'Google Inc. (NVIDIA Corporation)', renderer: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4070 Ti/PCIe/SSE2, OpenGL 4.5.0)' };
const WEBGL_SW = { vendor: 'Google Inc. (Google)', renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' };

describe('vendor detection', () => {
  it('adapter.info of the usual GPUs', () => {
    expect([NV_INFO, INTEL_INFO, AMD_INFO, APPLE_INFO].map(i => gpuAdapterVendorKey({ info: i }))).toEqual(['nvidia', 'intel', 'amd', 'apple']);
  });
  it('WebGL unmasked strings (ANGLE) of the usual GPUs', () => {
    expect(gpuVendorKey(WEBGL_INTEL.vendor, WEBGL_INTEL.renderer)).toBe('intel');
    expect(gpuVendorKey(WEBGL_NV.vendor, WEBGL_NV.renderer)).toBe('nvidia');
    expect(gpuVendorKey(WEBGL_SW.vendor, WEBGL_SW.renderer)).toBe('software');
    expect(gpuVendorKey('Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 7800 XT, OpenGL 4.6)')).toBe('amd');
  });
  it('anything unreadable is unknown', () => {
    expect([gpuAdapterVendorKey(null), gpuAdapterVendorKey({}), gpuAdapterVendorKey({ info: {} }), gpuVendorKey(), gpuVendorKey('', null)]).toEqual(['', '', '', '', '']);
    expect(gpuAdapterVendorKey({ get info() { throw new Error('x'); } })).toBe('');
  });
});

describe('split decision: only display Intel + compute NVIDIA on Linux', () => {
  const d = o => gpuSplitDecision({ os: 'linux', computeVendor: 'nvidia', lowPowerVendor: 'intel', displayVendor: 'intel', ...o });
  it('the hybrid case splits', () => {
    expect(d({})).toMatchObject({ split: true, renderVendor: 'intel', computeVendor: 'nvidia' });
  });
  it('every other vendor combination does not', () => {
    const vendors = ['nvidia', 'intel', 'amd', 'apple', 'software', 'other', ''];
    let splits = 0;
    for (const computeVendor of vendors) for (const lowPowerVendor of vendors) for (const displayVendor of vendors) {
      const r = d({ computeVendor, lowPowerVendor, displayVendor });
      if (r.split) { splits++; expect([computeVendor, lowPowerVendor, displayVendor]).toEqual(['nvidia', 'intel', 'intel']); }
    }
    expect(splits).toBe(1);
  });
  it('display NVIDIA (monitor on the NVIDIA port), AMD iGPU + NVIDIA, unknown display: no split', () => {
    expect(d({ displayVendor: 'nvidia' }).split).toBe(false);
    expect(d({ displayVendor: 'amd', lowPowerVendor: 'amd' }).split).toBe(false);
    expect(d({ displayVendor: '' }).reason).toBe('display gpu unknown');
  });
  it('single GPU: the low-power adapter is the NVIDIA one -> no split', () => {
    expect(d({ lowPowerVendor: 'nvidia', displayVendor: 'nvidia' }).split).toBe(false);
  });
  it('preference low-power (compute on Intel): no split', () => {
    expect(d({ computeVendor: 'intel' }).split).toBe(false);
  });
  it('not Linux: never', () => {
    for (const os of ['windows', 'mac', 'ios', 'android', 'other', undefined]) expect(d({ os }).split).toBe(false);
    expect(gpuSplitDecision().split).toBe(false);
  });
});

describe('UA gating (nothing else runs unless Linux + NVIDIA compute adapter)', () => {
  const nv = { info: NV_INFO };
  it('Linux + NVIDIA adapter is a candidate', () => expect(gpuSplitCandidate(LINUX, nv)).toBe(true));
  it('Windows, Mac, iPad, Android, ChromeOS: not', () => {
    for (const n of [WIN, MAC, IPAD, ANDROID, CROS, {}]) expect(gpuSplitCandidate(n, nv)).toBe(false);
  });
  it('Linux with a non-NVIDIA / unknown compute adapter: not', () => {
    for (const a of [{ info: INTEL_INFO }, { info: AMD_INFO }, { info: APPLE_INFO }, {}, null]) expect(gpuSplitCandidate(LINUX, a)).toBe(false);
  });
});

describe('WebGL display probe', () => {
  const doc = ctx => { const log = []; return { log, createElement: () => ({ getContext: () => ctx(log) }) }; };
  const glFor = (vendor, renderer) => log => ({
    getExtension: n => n === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 1, UNMASKED_RENDERER_WEBGL: 2 } : n === 'WEBGL_lose_context' ? { loseContext: () => log.push('lose') } : null,
    getParameter: p => (p === 1 ? vendor : renderer),
  });
  it('reads the unmasked vendor / renderer and releases the context', () => {
    const d = doc(glFor(WEBGL_INTEL.vendor, WEBGL_INTEL.renderer));
    expect(webglDisplayGpu(d)).toEqual(WEBGL_INTEL);
    expect(d.log).toEqual(['lose']);
  });
  it('null when there is no document, no context or no debug info', () => {
    expect(webglDisplayGpu(undefined)).toBe(null);
    expect(webglDisplayGpu(doc(() => null))).toBe(null);
    expect(webglDisplayGpu(doc(() => ({ getExtension: () => null })))).toBe(null);
    expect(webglDisplayGpu({ createElement: () => { throw new Error('x'); } })).toBe(null);
  });
});

describe('status parts', () => {
  it('empty when not split (single-GPU line unchanged)', () => {
    expect(gpuSplitStatusParts(null, 'WEBGPU VOLUME RESIDENT')).toEqual({ render: '', compute: '', computeName: 'Compute', computeLabel: 'WEBGPU VOLUME RESIDENT' });
    expect(gpuSplitStatusParts({ active: false }, 'WEBGPU')).toEqual({ render: '', compute: '', computeName: 'Compute', computeLabel: 'WEBGPU' });
  });
  const SPLIT = { active: true, renderVendor: 'intel', computeVendor: 'nvidia' };
  it('split wording', () => {
    expect(gpuSplitStatusParts(SPLIT, 'WEBGPU CORE FULL VERIFIED · WG256')).toEqual({ render: ' intel (display)', compute: ' nvidia (split)', computeName: 'Compute', computeLabel: 'WEBGPU CORE FULL VERIFIED · WG256' });
  });
  it('S4: in split mode the volume is named as on the render (display) GPU, not "Compute ... nvidia (split)"', () => {
    expect(gpuSplitStatusParts(SPLIT, 'WEBGPU VOLUME RESIDENT')).toEqual({ render: ' intel (display)', compute: ' intel (display)', computeName: 'Volume', computeLabel: 'WEBGPU RESIDENT' });
    expect(gpuSplitStatusParts(SPLIT, 'WEBGPU VOLUME RAYCAST').computeLabel).toBe('WEBGPU RAYCAST');
    expect(gpuSplitStatusParts(SPLIT, 'WEBGPU REDUCED VOLUME · LINEAR').computeLabel).toBe('WEBGPU REDUCED · LINEAR');
    // failures and the filter labels stay on compute
    for (const l of ['GPU VOLUME FALLBACK', 'GPU VOLUME ERROR', 'WEBGPU COMPUTE FAIL', 'WEBGPU CORE FULL VERIFIED · WG256']) expect(gpuSplitStatusParts(SPLIT, l).computeName).toBe('Compute');
    expect(['WEBGPU VOLUME PICK', 'WEBGPU VOLUME RESIDENT'].map(gpuIsVolumeLabel)).toEqual([true, true]);
    expect(['GPU VOLUME FALLBACK', 'WEBGPU GPU FAIL', '', undefined].map(gpuIsVolumeLabel)).toEqual([false, false, false, false]);
  });
  it('primary-GPU-only mode names the one GPU', () => {
    expect(gpuSplitStatusParts(null, 'WEBGPU', 'intel')).toMatchObject({ render: ' intel (primary)', compute: ' intel (primary)', computeName: 'Compute' });
  });
  it('hybrid mode sentence of the bar', () => {
    expect(gpuHybridStatusText({ hybridMode: 'primary', hybridVendor: 'intel' })).toBe('hybrid mode: primary GPU only (display + compute on intel)');
    expect(gpuHybridStatusText({ split: SPLIT, hybridMode: 'hybrid' })).toBe('hybrid mode: hybrid (display intel · compute nvidia)');
    expect(gpuHybridStatusText({})).toBe('');
    expect(gpuHybridStatusText(null)).toBe('');
  });
  it('the extra diagnostics appear only when something out of the ordinary happened', () => {
    expect(gpuStatusDetailed({ limitRetries: 0, adapterRequest: { supported: false, effective: 'auto' } })).toBe(false);
    expect(gpuStatusDetailed({ adapterRequest: { supported: true, effective: 'auto' } })).toBe(false);
    expect(gpuStatusDetailed(null)).toBe(false);
    expect(gpuStatusDetailed({}, true)).toBe(true);
    expect(gpuStatusDetailed({ limitRetries: 1 })).toBe(true);
    expect(gpuStatusDetailed({ renderLimitRetries: 2 })).toBe(true);
    expect(gpuStatusDetailed({ split: SPLIT })).toBe(true);
    expect(gpuStatusDetailed({ hybridSeen: true })).toBe(true);
    expect(gpuStatusDetailed({ hybridMode: 'primary' })).toBe(true);
    expect(gpuStatusDetailed({ adapterRequest: { supported: true, effective: 'low-power' } })).toBe(true);
    expect(gpuStatusDetailed({ adapterRequest: { supported: false, effective: 'low-power' } })).toBe(false);
  });
});

// ---- orchestration, cut out of the sources and run against fakes ----
const read = p => readFileSync(p, 'utf8');
const gpuSrc = read('docs/gpu-compute.js'), sceneSrc = read('docs/scene-view.js');
const grab = (src, re) => { const m = src.match(re); if (!m) throw new Error('not found: ' + re); return m[0].replace(/^export /, ''); };
const fnSrc = (src, name) => grab(src, new RegExp('export (async )?function ' + name + '\\([\\s\\S]*?\\n}\\n'));
const constSrc = (src, name) => grab(src, new RegExp('export const ' + name + '=[^\\n]*\\n'));
const MiB = 2 ** 20, GiB = 2 ** 30;
const LIMITS = { maxBufferSize: 4 * GiB - 4, maxStorageBufferBindingSize: 4 * GiB - 4, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxTextureDimension3D: 2048 };

// a machine with the listed adapters; requestAdapter picks by powerPreference like Chrome on a hybrid laptop
function fakeMachine(adapters, { deviceFails = () => false } = {}) {
  const log = [], devices = [];
  const mk = info => ({
    info, features: new Set(['core-features-and-limits']), limits: { ...LIMITS },
    async requestDevice(desc) {
      log.push('device ' + info.vendor + ' ' + (desc.requiredLimits.maxBufferSize === undefined ? 'default' : desc.requiredLimits.maxBufferSize / MiB + 'MB'));
      if (deviceFails(info.vendor)) throw new Error('Failed to create device: VK_ERROR_OUT_OF_DEVICE_MEMORY');
      const dev = { vendor: info.vendor, limits: desc.requiredLimits, queue: { onSubmittedWorkDone: async () => {} }, lost: new Promise(() => {}), destroyed: false, destroy() { this.destroyed = true; } };
      devices.push(dev); return dev;
    },
  });
  const high = adapters.find(a => a.high) || adapters[0], low = adapters.find(a => a.low) || adapters[0];
  return {
    log, devices,
    gpu: { async requestAdapter(opts) { log.push('adapter ' + (opts?.powerPreference || '-')); return mk((opts?.powerPreference === 'low-power' ? low : high).info); } },
  };
}
const HYBRID = [{ info: NV_INFO, high: true }, { info: INTEL_INFO, low: true }];
const ONLY_NV = [{ info: NV_INFO }];
const ONLY_INTEL = [{ info: INTEL_INFO }];

const buildCompute = (navigator, runtime = {}, extra = {}) => {
  const src = constSrc(gpuSrc, 'GPU_BUFFER_LIMIT_CAPS') + fnSrc(gpuSrc, 'gpuAdapterLabel') + fnSrc(gpuSrc, 'capGpuBufferLimits') + fnSrc(gpuSrc, 'gpuLimitInfoText') + fnSrc(gpuSrc, 'gpuDeviceRequestDescriptor') +
    constSrc(gpuSrc, 'vrlGpuPreference') + fnSrc(gpuSrc, 'requestVrlGpuAdapter') + fnSrc(gpuSrc, 'gpuLostAtCreation') + fnSrc(gpuSrc, 'requestVrlGpuDevice') + grab(gpuSrc, /export function gpuLostText[^\n]*\n/) +
    constSrc(gpuSrc, 'vrlHybridMode') + fnSrc(gpuSrc, 'requestVrlSplitRenderDevice') + fnSrc(gpuSrc, 'requestVrlPrimaryGpuDevice') + fnSrc(gpuSrc, 'adoptSplitGpuDevices') + fnSrc(gpuSrc, 'resetSplitGpuDevices') + fnSrc(gpuSrc, 'createGpuResidentFloat3Attribute') + fnSrc(gpuSrc, 'destroyGpuResidentAttribute') + fnSrc(gpuSrc, 'ensureGpuFilterDevice') +
    fnSrc(gpuSrc, 'updateGpuStatus') + fnSrc(gpuSrc, 'setGpuComputeBackend') +
    '\nreturn{requestVrlGpuDevice,requestVrlSplitRenderDevice,requestVrlPrimaryGpuDevice,vrlHybridMode,resetSplitGpuDevices,adoptSplitGpuDevices,createGpuResidentFloat3Attribute,ensureGpuFilterDevice,updateGpuStatus,setGpuComputeBackend}';
  const calls = [];
  const deps = {
    gpuForceCompat: false, navigator, gpuFilterRuntime: runtime, console: { info() {}, warn() {}, error() {} },
    gpuSplitCandidate, gpuSplitDecision, gpuVendorKey, gpuAdapterVendorKey, gpuSplitStatusParts, gpuHybridStatusText, gpuStatusDetailed, webglDisplayGpu, gpuPlatformOs, gpuEffectiveHybridMode,
    gpuEffectivePreference, gpuPreferenceSupported, gpuAdapterRequestOptions, gpuPreferenceInfoText, logGpuError() {},
    sceneState: { backend: 'WEBGPU', renderer: { backend: { device: null, set() {} } } },
    THREE: { Float32BufferAttribute: class { constructor(a) { this.array = a; } } },
    status: { removeAttribute() {}, textContent: '', className: '', title: '' }, document: { getElementById: () => null },
    performance: { now: () => 1000 }, updateLinuxWebgpuNote() {},
    installGpuErrorListener: (d, role) => calls.push('listener ' + (role || 'compute')),
    clearGpuBufferPool() {}, setGpuPrewarmIndex() {}, setGpuPrewarmScheduled() {}, gpuComputeWorkgroupSize: () => 128, gpuDeviceMode: () => 'CORE',
    verifyGpuComputeDevice: async () => true, verifyGpuPipelineSet: async () => true,
    ...extra,
  };
  const api = new Function('deps', 'const {' + Object.keys(deps).join(',') + '}=deps;' + src)(deps);
  return { api, calls, deps };
};
const rt = () => ({ device: null, adapter: null, initPromise: null, disabled: false, pipelines: new Map(), lastBackend: 'CPU', lastError: '', retryAfter: 0, bufferPool: new Map() });
const probeOf = (g, log) => () => { if (log) log.push('webgl'); return g; };

describe('requestVrlSplitRenderDevice: hybrid case', () => {
  it('Linux, display Intel, compute NVIDIA: render device on the low-power Intel adapter, compute records untouched', async () => {
    const m = fakeMachine(HYBRID), runtime = rt(), { api } = buildCompute({ ...LINUX, gpu: m.gpu }, runtime);
    const compute = await api.requestVrlGpuDevice();
    expect(compute.device.vendor).toBe('nvidia');
    const computeInfo = { limitInfo: runtime.limitInfo, prefInfo: runtime.prefInfo, adapterRequest: runtime.adapterRequest };
    const r = await api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) });
    expect(r.device.vendor).toBe('intel');
    expect(r.split).toMatchObject({ active: true, renderVendor: 'intel', computeVendor: 'nvidia' });
    expect(m.log.filter(l => l.startsWith('adapter'))).toEqual(['adapter high-performance', 'adapter low-power']);
    // the render request has its own records; the compute device's status data is not clobbered
    expect({ limitInfo: runtime.limitInfo, prefInfo: runtime.prefInfo, adapterRequest: runtime.adapterRequest }).toEqual(computeInfo);
    expect(runtime.renderLimitInfo).toMatch(/^limits buf /);
    expect(runtime.renderAdapterRequest).toBeTruthy();
  });
  it('the render device keeps the limit ladder; every step refused -> null', async () => {
    const m = fakeMachine(HYBRID, { deviceFails: v => v === 'intel' }), { api } = buildCompute({ ...LINUX, gpu: m.gpu }, rt());
    const compute = await api.requestVrlGpuDevice();
    m.log.length = 0;
    expect(await api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) })).toBe(null);
    expect(m.log.filter(l => l.startsWith('device'))).toEqual(['device intel ' + (4 * GiB - 4) / MiB + 'MB', 'device intel 2048MB', 'device intel 1024MB', 'device intel default']);
  });
  it('render device creation fails -> null (single shared device), compute device untouched', async () => {
    const m = fakeMachine(HYBRID, { deviceFails: v => v === 'intel' }), runtime = rt(), { api } = buildCompute({ ...LINUX, gpu: m.gpu }, runtime);
    const compute = await api.requestVrlGpuDevice();
    expect(await api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) })).toBe(null);
    expect(compute.device.destroyed).toBe(false);
    expect(runtime.splitNote).toMatch(/split not used/);
  });
  it('display is NVIDIA (monitor on the NVIDIA port): no extra adapter request, no split', async () => {
    const m = fakeMachine(HYBRID), { api } = buildCompute({ ...LINUX, gpu: m.gpu }, rt());
    const compute = await api.requestVrlGpuDevice();
    m.log.length = 0;
    expect(await api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_NV) })).toBe(null);
    expect(m.log).toEqual([]);
  });
  it('WebGL unreadable / software renderer: no split', async () => {
    const m = fakeMachine(HYBRID), { api } = buildCompute({ ...LINUX, gpu: m.gpu }, rt());
    const compute = await api.requestVrlGpuDevice();
    m.log.length = 0;
    for (const g of [null, WEBGL_SW]) expect(await api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(g) })).toBe(null);
    expect(m.log).toEqual([]);
  });
  it('the low-power request answers with the NVIDIA adapter (no real second GPU): rejected before any device request', async () => {
    const m = fakeMachine(ONLY_NV), { api } = buildCompute({ ...LINUX, gpu: m.gpu }, rt());
    const compute = await api.requestVrlGpuDevice();
    m.log.length = 0;
    expect(await api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) })).toBe(null);
    expect(m.log.filter(l => l.startsWith('device'))).toEqual([]);
  });
});

describe('single GPU / Mac / iPad / Windows: the extra work never starts (same path as before)', () => {
  const cases = [
    ['Mac (Apple)', MAC, [{ info: APPLE_INFO }]], ['iPad (Apple)', IPAD, [{ info: APPLE_INFO }]],
    ['Windows hybrid', WIN, HYBRID], ['Windows single NVIDIA', WIN, ONLY_NV],
    ['Linux single NVIDIA', LINUX, ONLY_NV], ['Linux single Intel', LINUX, ONLY_INTEL], ['Linux AMD', LINUX, [{ info: AMD_INFO }]],
    ['Android / Quest', ANDROID, [{ info: { vendor: 'qualcomm', description: 'Adreno' } }]],
  ];
  for (const [name, n, adapters] of cases) {
    it(name + ': no split, no extra requestAdapter', async () => {
      const m = fakeMachine(adapters), log = m.log, { api } = buildCompute({ ...n, gpu: m.gpu }, rt());
      const compute = await api.requestVrlGpuDevice();
      const before = [...log], probeLog = [];
      // a Linux single NVIDIA is a candidate for the cheap pre-check; its display GPU (WebGL) is the same NVIDIA -> no extra adapter
      expect(await api.requestVrlSplitRenderDevice({ nav: n, computeAdapter: compute.adapter, probe: probeOf(WEBGL_NV, probeLog) })).toBe(null);
      expect(log).toEqual(before);
      if (!(n === LINUX && adapters === ONLY_NV)) expect(probeLog).toEqual([]);
    });
  }
  it('Linux hybrid with preference low-power (compute on Intel): no split', async () => {
    const m = fakeMachine(HYBRID), { api } = buildCompute({ ...LINUX, gpu: m.gpu }, rt());
    const compute = await api.requestVrlGpuDevice({ preference: 'low-power' });
    expect(compute.device.vendor).toBe('intel');
    m.log.length = 0;
    expect(await api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) })).toBe(null);
    expect(m.log).toEqual([]);
  });
});

describe('split mode: devices and cross-device resources', () => {
  const setup = async () => {
    const m = fakeMachine(HYBRID), runtime = rt(), built = buildCompute({ ...LINUX, gpu: m.gpu }, runtime);
    const compute = await built.api.requestVrlGpuDevice();
    const render = await built.api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) });
    built.deps.sceneState.renderer.backend.device = render.device;
    return { m, runtime, built, compute, render };
  };
  it('adoptSplitGpuDevices: render listener only on the render device; compute handed to ensureGpuFilterDevice, not adopted as shared', async () => {
    const { runtime, built, compute, render } = await setup();
    built.api.adoptSplitGpuDevices(built.deps.sceneState.renderer, compute, render);
    expect(runtime.split).toMatchObject({ active: true });
    expect(runtime.renderDevice).toBe(render.device);
    expect(runtime.device).toBe(null);
    expect(runtime.sharedRendererDevice).toBe(false);
    expect(built.calls).toEqual(['listener render']);
    expect(runtime.pendingCompute.device).toBe(compute.device);
  });
  it("ensureGpuFilterDevice in split mode returns the compute (NVIDIA) device, never the renderer's", async () => {
    const { runtime, built, compute, render } = await setup();
    built.api.adoptSplitGpuDevices(built.deps.sceneState.renderer, compute, render);
    const device = await built.api.ensureGpuFilterDevice();
    expect(device).toBe(compute.device);
    expect(device).not.toBe(render.device);
    expect(runtime.sharedRendererDevice).toBe(false);
    expect(runtime.pendingCompute).toBe(null);
    expect(built.calls).toEqual(['listener render', 'listener compute']);
    expect(runtime.lastBackend).toBe('WEBGPU CORE FULL VERIFIED · WG128');
  });
  it('after the compute device is lost, the retry requests a new compute device (NVIDIA), not the Intel render device', async () => {
    const { m, runtime, built, compute, render } = await setup();
    built.api.adoptSplitGpuDevices(built.deps.sceneState.renderer, compute, render);
    await built.api.ensureGpuFilterDevice();
    runtime.device = null; // as the device.lost handler leaves it
    m.log.length = 0;
    const again = await built.api.ensureGpuFilterDevice();
    expect(again.vendor).toBe('nvidia');
    expect(again).not.toBe(render.device);
    expect(m.log.filter(l => l.startsWith('adapter'))).toEqual(['adapter high-performance']);
  });
  it('GPU-resident attribute: the compute device never shares a buffer with the renderer (null -> CPU readback path)', async () => {
    const { built, compute } = await setup();
    expect(built.api.createGpuResidentFloat3Attribute(compute.device, 300, 'VRL GPU resident position')).toBe(null);
  });
  it('GPU-resident attribute: unchanged on the shared device (single GPU)', () => {
    globalThis.GPUBufferUsage = { STORAGE: 1, VERTEX: 2, COPY_SRC: 4, COPY_DST: 8 };
    const device = { createBuffer: d => ({ size: d.size, destroy() {} }) };
    const set = [];
    const built = buildCompute({ ...LINUX }, rt(), {});
    built.deps.sceneState.renderer.backend = { device, set: (a, b) => set.push(b) };
    const resident = built.api.createGpuResidentFloat3Attribute(device, 300, 'VRL GPU resident position');
    expect(resident.buffer.size).toBe(300 * 3 * 4);
    expect(set.length).toBe(1);
  });
  it('render-device errors never become a compute FAIL', () => {
    const listenerSrc = fnSrc(gpuSrc, 'installGpuErrorListener');
    const handlers = {}, runtime = rt(), backendCalls = [];
    const device = { addEventListener: (n, h) => { handlers[n] = h; }, createTexture: () => ({}) };
    new Function('deps', 'const {installGpuLedger,gpuFilterRuntime,setGpuComputeBackend,updateGpuStatus,console,logGpuError}=deps;' + listenerSrc + 'installGpuErrorListener(deps.device,deps.role);')(
      { installGpuLedger() {}, logGpuError() {}, gpuFilterRuntime: runtime, setGpuComputeBackend: l => backendCalls.push(l), updateGpuStatus() {}, console: { error() {}, warn() {} }, device, role: 'render' });
    handlers.uncapturederror({ error: { message: 'Requested allocation size (10407936) is smaller than the image requires (11000000).' } });
    expect(backendCalls).toEqual([]);
    expect(runtime.lastError).toBe('');
    expect(runtime.renderError).toMatch(/^uncaptured: Requested allocation size/);
  });
});

describe('status line', () => {
  const statusOf = (runtime, sceneState = { backend: 'WEBGPU' }) => {
    const { api, deps } = buildCompute(LINUX, runtime, { sceneState });
    api.updateGpuStatus(); return deps.status;
  };
  it('single GPU line is unchanged', () => {
    const s = statusOf({ ...rt(), device: {}, lastBackend: 'WEBGPU CORE FULL VERIFIED · WG256', adapterLabel: 'nvidia ada NVIDIA GeForce RTX 4070 Ti' });
    expect(s.textContent).toBe('Render WEBGPU · Compute WEBGPU CORE FULL VERIFIED · WG256 · nvidia ada NVIDIA GeForce RTX 4070 Ti');
    expect(s.className).toBe('status status-ok');
  });
  it('split line names both GPUs', () => {
    const s = statusOf({ ...rt(), device: {}, lastBackend: 'WEBGPU', split: { active: true, renderVendor: 'intel', computeVendor: 'nvidia' } });
    expect(s.textContent).toBe('Render WEBGPU intel (display) · Compute WEBGPU nvidia (split)');
  });
  it('the last error: chip keeps 160 characters, title and the bar under the views show it in full', () => {
    const long = 'verify [anisotropic]: pipeline anisotropic: Requested allocation size (10407936) is smaller than the image requires (11280384). - While calling [Device].CreateTexture() with a long tail ' + 'x'.repeat(200);
    const bar = { classList: { toggle() {} } }, barText = { textContent: '' };
    const doc = { getElementById: id => (id === 'gpu-status-bar' ? bar : id === 'gpu-status-text' ? barText : null) };
    // the 160-character chip / full bar belong to the detailed status (retry, detected hybrid, debug); the plain
    // status keeps the 96 characters of builds up to 515
    const runtime = { ...rt(), device: {}, lastBackend: 'WEBGPU COMPUTE FAIL', lastError: long, limitRetries: 1 };
    const { api, deps } = buildCompute(LINUX, runtime, { document: doc });
    api.updateGpuStatus();
    expect(deps.status.textContent.length).toBeLessThan(220);
    expect(deps.status.textContent).toContain(long.slice(0, 160));
    expect(deps.status.title).toBe(long);
    // N3: the error is printed once in the bar, in full (not truncated + full)
    expect(barText.textContent.split('verify [anisotropic]').length).toBe(2);
    expect(barText.textContent).toContain(long);
    // a short error is shown once, in the chip, and the bar does not repeat it
    runtime.lastError = 'short error';
    api.updateGpuStatus();
    expect(deps.status.textContent).toContain(' · short error');
    expect(barText.textContent).toBe(deps.status.textContent);
  });
  it('a render error shows as Render error and does not touch the compute label', () => {
    const s = statusOf({ ...rt(), device: {}, lastBackend: 'WEBGPU CORE FULL VERIFIED · WG256', split: { active: true, renderVendor: 'intel', computeVendor: 'nvidia' }, renderError: 'uncaptured: boom' });
    expect(s.textContent).toBe('Render WEBGPU intel (display) · Compute WEBGPU CORE FULL VERIFIED · WG256 nvidia (split) · Render error: uncaptured: boom');
    expect(s.title).toBe('Render: uncaptured: boom');
  });
});

describe('create3DRenderer: split, fallback, unchanged single-device path', () => {
  const build = ({ split, splitInitFails = false, sharedInitFails = false, adoptThrows = false, primary = false }) => {
    const events = [];
    class Renderer { constructor(o) { this.o = o; events.push('new ' + o.device.name); } setPixelRatio() {} async init() { if ((this.o.device.name === 'render' && splitInitFails) || (this.o.device.name === 'core' && sharedInitFails)) throw new Error('init failed'); events.push('init ' + this.o.device.name); } }
    class WebGL { constructor() { events.push('webgl'); } setPixelRatio() {} setClearColor() {} }
    const core = { adapter: { info: NV_INFO }, device: { name: 'core', destroy() { events.push('destroy core'); } } };
    const render = { adapter: { info: INTEL_INFO }, device: { name: 'render', destroy() { events.push('destroy render'); } }, split: { active: true, renderVendor: 'intel', computeVendor: 'nvidia' } };
    const src = fnSrc(sceneSrc, 'create3DRenderer');
    const deps = {
      navigator: { gpu: {} }, devicePixelRatio: 1, console: { warn() {} },
      THREE: { WebGPURenderer: Renderer, Color: class {} }, WebGLRenderer: WebGL,
      requestVrlPrimaryGpuDevice: async () => { if (!primary) return null; events.push('primary-request'); return { adapter: { info: INTEL_INFO }, device: { name: 'core', destroy() {} } }; },
      resetSplitGpuDevices: note => events.push('reset ' + note),
      requestVrlGpuDevice: async () => { events.push('default-request'); return core; }, requestVrlSplitRenderDevice: async o => { events.push('split-request ' + o.computeAdapter.info.vendor); return split ? render : null; },
      adoptSplitGpuDevices: () => { events.push('adopt-split'); if (adoptThrows) throw new Error('adopt boom'); }, adoptRendererGpuDevice: (r, a, d) => events.push('adopt-shared ' + d.name),
      canvasBackground3d: () => null, onCanvasThemeChange() {}, request3DRender() {}, logGpuError() {},
    };
    const fn = new Function('deps', 'const {' + Object.keys(deps).join(',') + '}=deps;' + src + 'return create3DRenderer;')(deps);
    return { fn, events };
  };
  it('single device (no split): exactly the old calls', async () => {
    const { fn, events } = build({ split: false });
    const r = await fn();
    expect(r.backend).toBe('WEBGPU');
    expect(events).toEqual(['default-request', 'split-request nvidia', 'new core', 'init core', 'adopt-shared core']);
  });
  it('split: renderer on the render device, compute device handed over', async () => {
    const { fn, events } = build({ split: true });
    const r = await fn();
    expect(r.backend).toBe('WEBGPU');
    expect(events).toEqual(['default-request', 'split-request nvidia', 'new render', 'init render', 'adopt-split']);
  });
  it('split render init fails: render device destroyed, one shared device as before', async () => {
    const { fn, events } = build({ split: true, splitInitFails: true });
    const r = await fn();
    expect(r.backend).toBe('WEBGPU');
    expect(events).toEqual(['default-request', 'split-request nvidia', 'new render', 'destroy render', 'reset render device init failed: init failed', 'new core', 'init core', 'adopt-shared core']);
  });
  it('split render fails and the shared device fails too: WebGL, as before', async () => {
    const { fn, events } = build({ split: true, splitInitFails: true, sharedInitFails: true });
    const r = await fn();
    expect(r.backend).toBe('WEBGL');
    expect(events[events.length - 1]).toBe('webgl');
  });
  it('N2: adoptSplitGpuDevices throwing half-way resets the split state and names the reason; one shared device follows', async () => {
    const { fn, events } = build({ split: true, adoptThrows: true });
    const r = await fn();
    expect(r.backend).toBe('WEBGPU');
    expect(events).toEqual(['default-request', 'split-request nvidia', 'new render', 'init render', 'adopt-split', 'destroy render', 'reset render device init failed: adopt boom', 'new core', 'init core', 'adopt-shared core']);
  });
  it('primary-GPU-only: the primary device is the one device; the default request is never made', async () => {
    const { fn, events } = build({ split: false, primary: true });
    const r = await fn();
    expect(r.backend).toBe('WEBGPU');
    expect(events).toEqual(['primary-request', 'split-request intel', 'new core', 'init core', 'adopt-shared core']);
    expect(events).not.toContain('default-request');
  });
});

// ---- supervisor findings S1 / S2 / N2 / S4 / N3 and the hybrid-mode setting ----
describe('S2: single-GPU / Mac / iPad status equals the status of builds up to 515 (main)', () => {
  // main's updateGpuStatus text, verbatim, as the reference
  const mainStatus = rtm => {
    const render = rtm.render || 'INIT', compute = rtm.lastBackend || (rtm.device ? 'WEBGPU READY' : 'CPU');
    const adapter = rtm.adapterLabel ? ' · ' + rtm.adapterLabel : '';
    const failure = /FAIL|ERROR|LOST/.test(compute) && rtm.lastError ? ' · ' + rtm.lastError.slice(0, 96) : '';
    const chip = 'Render ' + render + ' · Compute ' + compute + failure + adapter;
    return { chip, bar: chip + (rtm.lastError && !failure ? ' · ' + rtm.lastError : ''), title: rtm.lastError || '' };
  };
  const run = (n, runtime) => {
    const bar = { classList: { toggle() {} } }, barText = { textContent: '' };
    const doc = { getElementById: id => (id === 'gpu-status-bar' ? bar : id === 'gpu-status-text' ? barText : null) };
    const { api, deps } = buildCompute(n, runtime, { document: doc, sceneState: { backend: 'WEBGPU' } });
    api.updateGpuStatus();
    return { chip: deps.status.textContent, bar: barText.textContent, title: deps.status.title };
  };
  const LIMIT_INFO = 'limits buf 4096MB/bind 4096MB (adapter 4096MB/4096MB)';
  const healthy = extra => ({ ...rt(), device: {}, lastBackend: 'WEBGPU CORE FULL VERIFIED · WG256', adapterLabel: 'apple metal-3', limitInfo: LIMIT_INFO, limitRetries: 0, ...extra });
  it("an earlier change's hook: updateGpuStatus ends with updateLinuxWebgpuNote() on every path", () => {
    let calls = 0;
    const { api } = buildCompute(LINUX, healthy({}), { updateLinuxWebgpuNote: () => { calls++; }, document: { getElementById: () => null } });
    api.updateGpuStatus(); api.updateGpuStatus();
    expect(calls).toBe(2);
    expect(/updateLinuxWebgpuNote\(\);\n}\n/.test(gpuSrc)).toBe(true);
    expect(gpuSrc).toContain("import { updateLinuxWebgpuNote } from './linux-webgpu-note.js");
  });
  it('Mac: the exact string (limitInfo is recorded but not shown)', () => {
    const r = run(MAC, healthy({ adapterRequest: { stored: 'auto', effective: 'auto', supported: false, optionIndex: 0 } }));
    expect(r.chip).toBe('Render WEBGPU · Compute WEBGPU CORE FULL VERIFIED · WG256 · apple metal-3');
    expect(r.bar).toBe('Render WEBGPU · Compute WEBGPU CORE FULL VERIFIED · WG256 · apple metal-3');
    expect(r.title).toBe('');
  });
  it('iPad: the exact string', () => {
    const r = run(IPAD, healthy({ adapterLabel: 'apple metal-3', adapterRequest: { effective: 'auto', supported: false } }));
    expect(r.bar).toBe('Render WEBGPU · Compute WEBGPU CORE FULL VERIFIED · WG256 · apple metal-3');
    expect(r.chip).toBe(r.bar);
  });
  it('Linux single NVIDIA (splitNote recorded by the pre-check, no retry): no split note, no limits, no preference', () => {
    const r = run(LINUX, healthy({ adapterLabel: 'nvidia ada NVIDIA GeForce RTX 4070 Ti', splitNote: 'display nvidia, compute nvidia', prefInfo: 'GPU pref auto → nvidia ada (request #1)', adapterRequest: { stored: 'auto', effective: 'auto', supported: true, optionIndex: 0 } }));
    expect(r.bar).toBe('Render WEBGPU · Compute WEBGPU CORE FULL VERIFIED · WG256 · nvidia ada NVIDIA GeForce RTX 4070 Ti');
    expect(r.bar).not.toMatch(/GPU split|limits buf|GPU pref/);
    expect(r.chip).toBe(r.bar);
  });
  it('Windows with the default preference: unchanged too', () => {
    const r = run(WIN, healthy({ prefInfo: 'GPU pref auto → nvidia (request #1)', adapterRequest: { effective: 'auto', supported: true } }));
    expect(r.bar).toBe('Render WEBGPU · Compute WEBGPU CORE FULL VERIFIED · WG256 · apple metal-3');
  });
  it('equals the reference (main) text over healthy / short-error / long-error / CPU states', () => {
    const states = [
      healthy({}), healthy({ lastBackend: 'CPU COMPUTE · GPU ERROR', lastError: 'boom' }), healthy({ lastBackend: 'WEBGPU COMPUTE FAIL', lastError: 'e'.repeat(120) }),
      healthy({ lastBackend: 'CPU', device: null, lastError: 'navigator.gpu is unavailable', adapterLabel: '' }), healthy({ lastBackend: 'WEBGPU GPU FAIL', lastError: 'uncaptured: x'.repeat(30) }),
    ];
    for (const n of [MAC, IPAD, LINUX, WIN]) for (const st of states) {
      const got = run(n, { ...st, adapterRequest: { effective: 'auto', supported: n === LINUX || n === WIN } }), want = mainStatus({ ...st, render: 'WEBGPU' });
      expect(got).toEqual(want);
    }
  });
  it('a retry shows the limits line (and the 160-character error, once, in the bar)', () => {
    const long = 'x'.repeat(300);
    const r = run(LINUX, healthy({ limitRetries: 1, limitInfo: LIMIT_INFO + ' · retry 4096MB failed: boom', lastBackend: 'WEBGPU COMPUTE FAIL', lastError: long }));
    expect(r.bar).toContain('retry 4096MB failed: boom');
    expect(r.chip).toContain('x'.repeat(160) + '…');
    expect(r.bar.split('x'.repeat(160)).length).toBe(2); // the error only once
    expect(r.bar).toContain(long);
  });
  it('a non-default 「使う GPU」 shows its line; ?debug shows everything', () => {
    const r = run(LINUX, healthy({ prefInfo: 'GPU pref low-power → intel gen-12lp (request #1)', adapterRequest: { effective: 'low-power', supported: true } }));
    expect(r.bar).toContain(' · GPU pref low-power → intel gen-12lp (request #1) · limits buf');
    globalThis.__vrlSettings = { debugOn: () => true };
    try { expect(run(MAC, healthy({ splitNote: 'display nvidia, compute nvidia' })).bar).toContain('limits buf 4096MB'); } finally { delete globalThis.__vrlSettings; }
  });
  it('a hybrid that was detected (display Intel, compute NVIDIA) but not split shows why', () => {
    const r = run(LINUX, healthy({ hybridSeen: true, splitNote: 'split not used: render device boom' }));
    expect(r.bar).toContain(' · GPU split: split not used: render device boom');
    expect(r.chip).not.toContain('GPU split');
  });
  it('split mode: the volume is on the display GPU; filters stay on compute; the bar names the mode', () => {
    const split = { active: true, renderVendor: 'intel', computeVendor: 'nvidia' };
    const v = run(LINUX, healthy({ split, hybridMode: 'hybrid', lastBackend: 'WEBGPU VOLUME RESIDENT', adapterLabel: '' }));
    expect(v.chip).toBe('Render WEBGPU intel (display) · Volume WEBGPU RESIDENT intel (display)');
    expect(v.bar).toContain('hybrid mode: hybrid (display intel · compute nvidia)');
    const c = run(LINUX, healthy({ split, hybridMode: 'hybrid', adapterLabel: '' }));
    expect(c.chip).toBe('Render WEBGPU intel (display) · Compute WEBGPU CORE FULL VERIFIED · WG256 nvidia (split)');
  });
  it('primary-GPU-only mode: chip and bar say so', () => {
    const r = run(LINUX, healthy({ hybridMode: 'primary', hybridVendor: 'intel', hybridSeen: true, adapterLabel: 'intel gen-12lp', splitNote: 'primary GPU only: intel for display and compute (no nvidia device)' }));
    expect(r.chip).toBe('Render WEBGPU intel (primary) · Compute WEBGPU CORE FULL VERIFIED · WG256 intel (primary) · intel gen-12lp');
    expect(r.bar).toContain('hybrid mode: primary GPU only (display + compute on intel)');
    expect(r.bar).toContain('GPU split: primary GPU only: intel for display and compute');
  });
});

describe('S1: a compute device that fails its verification is released and leaves nothing behind', () => {
  const failing = { verifyGpuComputeDevice: async () => { throw new Error('verify boom'); } };
  it('pipelines, pool and prewarm are reset and the device destroyed', async () => {
    const m = fakeMachine(ONLY_INTEL), runtime = rt(), log = [];
    runtime.pipelines.set('gaussian', { fromFailedDevice: true });
    const built = buildCompute({ ...LINUX, gpu: m.gpu }, runtime, { ...failing, clearGpuBufferPool: () => log.push('pool'), setGpuPrewarmIndex: n => log.push('idx ' + n), setGpuPrewarmScheduled: b => log.push('sched ' + b) });
    expect(await built.api.ensureGpuFilterDevice()).toBe(null);
    expect(runtime.pipelines.size).toBe(0);
    expect(m.devices.length).toBe(1);
    expect(m.devices[0].destroyed).toBe(true);
    expect(runtime.device).toBe(null);
    expect(log).toEqual(['pool', 'idx 0', 'sched false']);
    expect(runtime.lastBackend).toBe('CPU COMPUTE · GPU ERROR');
  });
  it("the renderer's own device is never destroyed", async () => {
    const m = fakeMachine(ONLY_INTEL), runtime = rt(), shared = { vendor: 'x', destroyed: false, destroy() { this.destroyed = true; }, lost: new Promise(() => {}) };
    runtime.split = { active: true }; runtime.pendingCompute = { adapter: { info: INTEL_INFO }, device: shared };
    const built = buildCompute({ ...LINUX, gpu: m.gpu }, runtime, { ...failing, sceneState: { backend: 'WEBGPU', renderer: { backend: { device: shared } } } });
    expect(await built.api.ensureGpuFilterDevice()).toBe(null);
    expect(shared.destroyed).toBe(false);
  });
  it('a new device does not inherit pipelines of another one', async () => {
    const m = fakeMachine(ONLY_INTEL), runtime = rt();
    runtime.pipelines.set('stale', {});
    const built = buildCompute({ ...LINUX, gpu: m.gpu }, runtime);
    const device = await built.api.ensureGpuFilterDevice();
    expect(device).toBe(m.devices[0]);
    expect(runtime.pipelines.has('stale')).toBe(false);
  });
});

describe('N2: resetSplitGpuDevices', () => {
  it('forgets the split, the render device and the pending compute device and records the reason', () => {
    const runtime = { ...rt(), split: { active: true, renderVendor: 'intel', computeVendor: 'nvidia' }, hybridMode: 'hybrid', renderDevice: {}, pendingCompute: { device: {} }, renderError: 'x', renderInfo: 'y', renderAdapterLabel: 'z' };
    const { api } = buildCompute(LINUX, runtime);
    api.resetSplitGpuDevices('render device init failed: boom');
    expect(runtime).toMatchObject({ split: null, hybridMode: '', renderDevice: null, pendingCompute: null, renderError: '', renderInfo: '', renderAdapterLabel: '', splitNote: 'render device init failed: boom' });
  });
  it('a render device destroyed after the reset does not leave a "lost" error', async () => {
    const m = fakeMachine(HYBRID), runtime = rt(), built = buildCompute({ ...LINUX, gpu: m.gpu }, runtime);
    const compute = await built.api.requestVrlGpuDevice();
    const render = await built.api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) });
    let lose; render.device.lost = new Promise(r => { lose = r; });
    built.api.adoptSplitGpuDevices(built.deps.sceneState.renderer, compute, render);
    expect(runtime.hybridMode).toBe('hybrid');
    built.api.resetSplitGpuDevices('render device init failed: x');
    lose({ reason: 'destroyed', message: 'gone' }); await Promise.resolve(); await Promise.resolve();
    expect(runtime.renderError).toBe('');
  });
});

describe('「ハイブリッド環境での処理」 (gpuHybridMode): Linux hybrid only', () => {
  const settings = v => { globalThis.__vrlSettings = { get: k => (k === 'gpuHybridMode' ? v : undefined) }; };
  afterEach(() => { delete globalThis.__vrlSettings; });
  const primary = async (n, adapters, g, opts = {}) => {
    const m = fakeMachine(adapters, opts.machine), runtime = rt(), built = buildCompute({ ...n, gpu: m.gpu }, runtime);
    const got = await built.api.requestVrlPrimaryGpuDevice({ nav: n, probe: probeOf(g), ...opts.args });
    return { m, runtime, got, built };
  };
  it('the mode resolves to hybrid everywhere but Linux', () => {
    for (const n of [MAC, IPAD, WIN, ANDROID, CROS, {}]) { expect(gpuHybridModeSupported(n)).toBe(false); expect(gpuEffectiveHybridMode('primary', n)).toBe('hybrid'); }
    expect(gpuHybridModeSupported(LINUX)).toBe(true);
    expect(gpuEffectiveHybridMode('primary', LINUX)).toBe('primary');
    for (const v of ['hybrid', 'auto', undefined, null, '', 1]) expect(gpuEffectiveHybridMode(v, LINUX)).toBe('hybrid');
  });
  it("'primary' on the hybrid: one device on the low-power Intel adapter, no NVIDIA device is created", async () => {
    settings('primary');
    const { m, runtime, got, built } = await primary(LINUX, HYBRID, WEBGL_INTEL);
    expect(got.device.vendor).toBe('intel');
    expect(m.devices.map(d => d.vendor)).toEqual(['intel']);
    expect(m.log.filter(l => l.startsWith('device'))).toEqual(['device intel ' + (4 * GiB - 4) / MiB + 'MB']);
    expect(runtime).toMatchObject({ hybridMode: 'primary', hybridVendor: 'intel', hybridSeen: true });
    // the renderer's split step then returns at once (the compute adapter is Intel): no second device, no extra request
    const before = [...m.log];
    expect(await built.api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: got.adapter, probe: probeOf(WEBGL_INTEL) })).toBe(null);
    expect(m.log).toEqual(before);
  });
  it("'primary' keeps the limit ladder of the Intel device and never touches NVIDIA", async () => {
    settings('primary');
    const { m, got } = await primary(LINUX, HYBRID, WEBGL_INTEL, { machine: { deviceFails: v => v === 'intel' } });
    expect(got).toBe(null);
    expect(m.log.filter(l => l.startsWith('device nvidia')).length).toBe(0);
    expect(m.log.filter(l => l.startsWith('device intel')).length).toBe(4);
  });
  it("'hybrid' (default): nothing happens here; the split of is as before", async () => {
    for (const v of ['hybrid', undefined]) {
      settings(v);
      const { m, got } = await primary(LINUX, HYBRID, WEBGL_INTEL);
      expect(got).toBe(null);
      expect(m.log).toEqual([]);
    }
    settings('hybrid');
    const m = fakeMachine(HYBRID), built = buildCompute({ ...LINUX, gpu: m.gpu }, rt());
    const compute = await built.api.requestVrlGpuDevice();
    const split = await built.api.requestVrlSplitRenderDevice({ nav: LINUX, computeAdapter: compute.adapter, probe: probeOf(WEBGL_INTEL) });
    expect([compute.device.vendor, split.device.vendor]).toEqual(['nvidia', 'intel']);
    expect(split.split.active).toBe(true);
  });
  it("the setting is ignored off Linux (value 'primary' stored): no adapter request at all", async () => {
    settings('primary');
    for (const [n, adapters] of [[MAC, [{ info: APPLE_INFO }]], [IPAD, [{ info: APPLE_INFO }]], [WIN, HYBRID], [ANDROID, [{ info: { vendor: 'qualcomm' } }]], [CROS, HYBRID]]) {
      const { m, got } = await primary(n, adapters, WEBGL_INTEL);
      expect(got).toBe(null);
      expect(m.log).toEqual([]);
    }
  });
  it("'primary' on a machine that is not that hybrid is ignored (no device created, the default path follows)", async () => {
    settings('primary');
    const cases = [
      ['single NVIDIA, display NVIDIA', ONLY_NV, WEBGL_NV], ['monitor on the NVIDIA port of a hybrid', HYBRID, WEBGL_NV], ['single Intel', ONLY_INTEL, WEBGL_INTEL],
      ['AMD', [{ info: AMD_INFO }], WEBGL_INTEL], ['display unreadable', HYBRID, null], ['software renderer', HYBRID, WEBGL_SW], ['no second GPU (low-power answers NVIDIA)', ONLY_NV, WEBGL_INTEL],
    ];
    for (const [name, adapters, g] of cases) {
      const { m, got } = await primary(LINUX, adapters, g);
      expect(got, name).toBe(null);
      expect(m.devices.length, name).toBe(0);
    }
  });
  it('「使う GPU」 low-power already puts compute on the Intel GPU: nothing to decide', async () => {
    settings('primary');
    const { m, got } = await primary(LINUX, HYBRID, WEBGL_INTEL, { args: { preference: 'low-power' } });
    expect(got).toBe(null);
    expect(m.log).toEqual([]);
  });
  it("compute started later (no renderer device) in 'primary' goes to the primary GPU too", async () => {
    settings('primary');
    const m = fakeMachine(HYBRID), runtime = rt();
    const built = buildCompute({ ...LINUX, gpu: m.gpu }, runtime, { webglDisplayGpu: probeOf(WEBGL_INTEL), sceneState: { backend: 'WEBGL', renderer: null } });
    const device = await built.api.ensureGpuFilterDevice();
    expect(device.vendor).toBe('intel');
    expect(m.devices.map(d => d.vendor)).toEqual(['intel']);
  });
});

describe('settings dialog: the hybrid-mode row', () => {
  const shell = readFileSync('docs/ui-shell.js', 'utf8'), i18n = readFileSync('docs/i18n.js', 'utf8'), ui = readFileSync('docs/settings-ui.js', 'utf8'), defaults = readFileSync('docs/app-settings.js', 'utf8');
  it('the row exists in the render panel, hidden until shown; two choices', () => {
    expect(shell).toMatch(/<label id="gpu-hybrid-row" class="settings-row" hidden>/);
    expect(shell).toMatch(/<select id="set-gpu-hybrid"[^>]*><option value="hybrid" data-i18n="gpuHybridSplit"><\/option><option value="primary" data-i18n="gpuHybridPrimary"><\/option><\/select>/);
    expect(shell).toMatch(/<p id="gpu-hybrid-hint" class="hint" data-i18n="gpuHybridHint" hidden>/);
    expect(shell).toMatch(/<p id="gpu-hybrid-reload" class="hint" hidden>/);
    const render = shell.slice(shell.indexOf('data-settings-panel="render"'), shell.indexOf('data-settings-panel="cache"'));
    expect(render).toContain('id="set-gpu-hybrid"');
  });
  it('i18n: ja and en for every key', () => {
    for (const k of ['gpuHybridLabel', 'gpuHybridSplit', 'gpuHybridPrimary', 'gpuHybridHint']) expect([...i18n.matchAll(new RegExp('[{,\\s]' + k + ':', 'g'))].length).toBe(2);
    expect(i18n).toContain("gpuHybridLabel:'ハイブリッド環境での処理'");
    expect(i18n).toContain("gpuHybridSplit:'ハイブリッド（表示 Intel・計算 NVIDIA）'");
    expect(i18n).toContain("gpuHybridPrimary:'プライマリ GPU のみ（表示中の GPU で全部）'");
    for (const m of shell.matchAll(/data-i18n="(gpuHybrid[A-Za-z]*)"/g)) expect(i18n).toContain(m[1] + ':');
  });
  it('shown on Linux only, saved with the other settings, reload note on a change', () => {
    expect(ui).toContain('gpuHybridModeSupported()');
    expect(ui).toContain('hybRow.hidden=!hybOn');
    expect(ui).toContain("settings.set('gpuHybridMode',hybSel.value)");
    expect(ui).toContain('hybReload.hidden=hybSel.value===loadedHybrid');
    expect(ui).toContain("put('set-gpu-hybrid',gpuEffectiveHybridMode(v.gpuHybridMode))");
    expect(defaults).toMatch(/gpuHybridMode:'hybrid'/);
  });
});
