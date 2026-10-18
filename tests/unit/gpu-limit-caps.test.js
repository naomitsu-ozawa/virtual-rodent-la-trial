import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(p, 'utf8');
const gpuSrc = read('docs/gpu-compute.js');
const grab = (src, re) => { const m = src.match(re); if (!m) throw new Error('not found: ' + re); return m[0].replace(/^export /, ''); };
const fnSrc = (src, name) => grab(src, new RegExp('export (async )?function ' + name + '\\([\\s\\S]*?\\n}\\n'));

const capsSrc = grab(gpuSrc, /export const GPU_BUFFER_LIMIT_CAPS=[^\n]*\n/);
import { gpuEffectivePreference, gpuPreferenceSupported, gpuAdapterRequestOptions, gpuPreferenceInfoText } from '../../docs/gpu-preference.js';
const build = (forceCompat = false) => new Function('gpuForceCompat', 'navigator', 'gpuFilterRuntime', 'console', 'gpuEffectivePreference', 'gpuPreferenceSupported', 'gpuAdapterRequestOptions', 'gpuPreferenceInfoText', 'logGpuError',
  capsSrc + fnSrc(gpuSrc, 'capGpuBufferLimits') + fnSrc(gpuSrc, 'gpuLimitInfoText') + fnSrc(gpuSrc, 'gpuDeviceRequestDescriptor') + grab(gpuSrc, /export const vrlGpuPreference=[^\n]*\n/) +
  fnSrc(gpuSrc, 'requestVrlGpuAdapter') + fnSrc(gpuSrc, 'gpuLostAtCreation') + fnSrc(gpuSrc, 'requestVrlGpuDevice') + grab(gpuSrc, /export function gpuLostText[^\n]*\n/) +
  '\nreturn{gpuLostAtCreation,GPU_BUFFER_LIMIT_CAPS,capGpuBufferLimits,gpuLimitInfoText,gpuDeviceRequestDescriptor,requestVrlGpuDevice,requestVrlGpuAdapter,vrlGpuPreference,gpuLostText}');
const quiet = { info() {}, warn() {} };
// build 515: the GPU preference helpers (docs/gpu-preference.js, pure) are the real ones; the module's `navigator` is injected
const prefDeps = [gpuEffectivePreference, gpuPreferenceSupported, gpuAdapterRequestOptions, gpuPreferenceInfoText, () => {}]; // the last one: logGpuError (build 520, in-memory log, not under test here)
const api = (forceCompat = false, navigator = {}, runtime = {}) => build()(forceCompat, navigator, runtime, quiet, ...prefDeps);

// the request as it was up to build 502 (verbatim, for the "unchanged below the cap" checks)
function oldDescriptor(adapter, gpuForceCompat = false) {
  const requiredFeatures = []; if (!gpuForceCompat && adapter?.features?.has?.('core-features-and-limits')) requiredFeatures.push('core-features-and-limits');
  if (!requiredFeatures.includes('core-features-and-limits')) { const all = {}; for (const k in adapter?.limits || {}) { const v = adapter.limits[k]; if (typeof v === 'number' && Number.isFinite(v)) all[k] = v; } return { requiredFeatures, requiredLimits: all }; }
  const requiredLimits = {};
  if ((adapter?.limits?.maxComputeInvocationsPerWorkgroup || 0) >= 256) requiredLimits.maxComputeInvocationsPerWorkgroup = 256;
  if ((adapter?.limits?.maxComputeWorkgroupSizeX || 0) >= 256) requiredLimits.maxComputeWorkgroupSizeX = 256;
  const maxBufferSize = Number(adapter?.limits?.maxBufferSize) || 0; if (maxBufferSize > 0) requiredLimits.maxBufferSize = maxBufferSize;
  const maxStorageBufferBindingSize = Number(adapter?.limits?.maxStorageBufferBindingSize) || 0; if (maxStorageBufferBindingSize > 0) requiredLimits.maxStorageBufferBindingSize = maxStorageBufferBindingSize;
  return { requiredFeatures, requiredLimits };
}

const MiB = 2 ** 20, GiB = 2 ** 30;
const PROFILES = {
  'NVIDIA RTX 4070 Ti (Vulkan)': { core: true, limits: { maxBufferSize: 4 * GiB - 4, maxStorageBufferBindingSize: 4 * GiB - 4, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupStorageSize: 32768, maxTextureDimension3D: 2048 } },
  'Intel UHD 770 (Vulkan)': { core: true, limits: { maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 1 * GiB, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupStorageSize: 32768, maxTextureDimension3D: 2048 } },
  'Apple M-series (Metal, 2 GiB tier)': { core: true, limits: { maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB - 4, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupStorageSize: 32768, maxTextureDimension3D: 2048 } },
  'Apple M-series (Metal, 4 GiB tier)': { core: true, limits: { maxBufferSize: 4 * GiB - 4, maxStorageBufferBindingSize: 4 * GiB - 4, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupStorageSize: 32768, maxTextureDimension3D: 2048 } },
  'iPad (Metal)': { core: true, limits: { maxBufferSize: 1 * GiB, maxStorageBufferBindingSize: 1 * GiB, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupStorageSize: 32768, maxTextureDimension3D: 2048 } },
  'Quest (Adreno, Vulkan)': { core: true, limits: { maxBufferSize: 1 * GiB, maxStorageBufferBindingSize: 512 * MiB, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupStorageSize: 32768, maxTextureDimension3D: 2048 } },
  'Linux OpenGL ES (compat)': { core: false, limits: { maxBufferSize: 4 * GiB - 4, maxStorageBufferBindingSize: 4 * GiB - 4, maxComputeInvocationsPerWorkgroup: 256, maxComputeWorkgroupSizeX: 256, maxStorageBuffersPerShaderStage: 8, maxTextureDimension3D: 2048 } },
};
const adapterOf = p => ({ features: new Set(p.core ? ['core-features-and-limits'] : []), limits: { ...p.limits } });
const over4G = p => p.limits.maxBufferSize > 4 * GiB || p.limits.maxStorageBufferBindingSize > 4 * GiB - 4;
const big = (b, s) => ({ core: true, limits: { maxBufferSize: b, maxStorageBufferBindingSize: s, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupStorageSize: 32768, maxTextureDimension3D: 2048 } });

describe('device request: buffer limits capped at 4 GiB (min(adapter, cap))', () => {
  const { gpuDeviceRequestDescriptor } = api();
  for (const [name, p] of Object.entries(PROFILES)) {
    it(name, () => {
      const now = gpuDeviceRequestDescriptor(adapterOf(p)), before = oldDescriptor(adapterOf(p));
      // every profile reports <= 4 GiB - 4, so the request is exactly the adapter's (as before build 508)
      expect(over4G(p)).toBe(false);
      expect(now).toEqual(before);
    });
  }
  it('NVIDIA 4 GiB - 4: requested unchanged (the adapter max)', () => {
    const l = gpuDeviceRequestDescriptor(adapterOf(PROFILES['NVIDIA RTX 4070 Ti (Vulkan)'])).requiredLimits;
    expect(l.maxBufferSize).toBe(4 * GiB - 4);
    expect(l.maxStorageBufferBindingSize).toBe(4 * GiB - 4);
  });
  it('adapter 8 GiB: capped at 4 GiB buffer / 4 GiB - 4 binding (u32-safe, multiple of 4); nothing else changes', () => {
    for (const core of [true, false]) {
      const p = { ...big(8 * GiB, 8 * GiB), core };
      const now = gpuDeviceRequestDescriptor(adapterOf(p)), before = oldDescriptor(adapterOf(p));
      expect(now.requiredFeatures).toEqual(before.requiredFeatures);
      expect(now.requiredLimits).toEqual({ ...before.requiredLimits, maxBufferSize: 4 * GiB, maxStorageBufferBindingSize: 4 * GiB - 4 });
      expect(now.requiredLimits.maxStorageBufferBindingSize).toBeLessThan(2 ** 32);
      expect(now.requiredLimits.maxStorageBufferBindingSize % 4).toBe(0);
    }
  });
  it('adapter reporting exactly 4 GiB / 6 GiB mixes: min per limit', () => {
    const l1 = gpuDeviceRequestDescriptor(adapterOf(big(4 * GiB, 4 * GiB))).requiredLimits;
    expect([l1.maxBufferSize, l1.maxStorageBufferBindingSize]).toEqual([4 * GiB, 4 * GiB - 4]);
    const l2 = gpuDeviceRequestDescriptor(adapterOf(big(6 * GiB, 3 * GiB))).requiredLimits;
    expect([l2.maxBufferSize, l2.maxStorageBufferBindingSize]).toEqual([4 * GiB, 3 * GiB]);
  });
  it('adapter <= 2 GiB (iPad / Mac / Intel / Quest tiers) is unchanged', () => {
    for (const k of ['Intel UHD 770 (Vulkan)', 'Apple M-series (Metal, 2 GiB tier)', 'iPad (Metal)', 'Quest (Adreno, Vulkan)']) {
      const a = adapterOf(PROFILES[k]);
      expect(gpuDeviceRequestDescriptor(a)).toEqual(oldDescriptor(a));
    }
  });
  it('every Dawn tier up to 4 GiB - 4 requests exactly what it did before (core and compat)', () => {
    const bufs = [256 * MiB, 1 * GiB, 2 * GiB, 4 * GiB - 4], binds = [128 * MiB, 256 * MiB, 512 * MiB, 1 * GiB, 2 * GiB - 4, 4 * GiB - 4];
    for (const core of [true, false]) for (const b of bufs) for (const s of binds) {
      const a = adapterOf({ core, limits: { maxBufferSize: b, maxStorageBufferBindingSize: s, maxComputeInvocationsPerWorkgroup: 256, maxComputeWorkgroupSizeX: 256 } });
      expect(gpuDeviceRequestDescriptor(a)).toEqual(oldDescriptor(a));
    }
  });
  it('the requested binding size stays a multiple of 4 and <= maxBufferSize at every cap', () => {
    const { GPU_BUFFER_LIMIT_CAPS } = api();
    expect(GPU_BUFFER_LIMIT_CAPS).toEqual([4 * GiB, 2 * GiB, 1 * GiB, 0]);
    for (const cap of GPU_BUFFER_LIMIT_CAPS) {
      const l = gpuDeviceRequestDescriptor(adapterOf(big(8 * GiB, 8 * GiB)), cap).requiredLimits;
      if (cap === 0) { expect(l.maxBufferSize).toBeUndefined(); expect(l.maxStorageBufferBindingSize).toBeUndefined(); continue; }
      expect(l.maxStorageBufferBindingSize % 4).toBe(0);
      expect(l.maxStorageBufferBindingSize).toBeLessThan(2 ** 32);
      expect(l.maxStorageBufferBindingSize).toBeLessThanOrEqual(l.maxBufferSize);
      expect(l.maxBufferSize).toBeLessThanOrEqual(cap);
    }
  });
  it('the forced compatibility device (?gpucompat) is capped the same way (8 GiB adapter -> 4 GiB)', () => {
    const forced = build()(true, {}, {}, quiet, ...prefDeps).gpuDeviceRequestDescriptor(adapterOf(big(8 * GiB, 8 * GiB)));
    expect(forced.requiredFeatures).toEqual([]);
    expect(forced.requiredLimits.maxBufferSize).toBe(4 * GiB);
    expect(forced.requiredLimits.maxStorageBufferBindingSize).toBe(4 * GiB - 4);
    expect(forced.requiredLimits.maxComputeWorkgroupStorageSize).toBe(32768);
  });
});

// Sizes the app derives from device.limits: with the capped request they must equal the sizes of the old request.
const sfSrc = read('docs/source-filters.js'), sbSrc = read('docs/surface-build.js'), srSrc = read('docs/segment-runs.js');
const derived = (limits, desktop = true, touch = 0) => {
  const runtime = { device: { limits } }, nav = { maxTouchPoints: touch };
  const f = new Function('navigator', 'isDesktopRuntime', 'gpuFilterRuntime',
    fnSrc(sfSrc, 'sourceTileBudget') + fnSrc(sfSrc, 'volumeBlockBudget') + fnSrc(sbSrc, 'gpuMeshBlockDepth') +
    'return{tile:sourceTileBudget(),block:volumeBlockBudget(),mesh:gpuMeshBlockDepth()}')(nav, () => desktop, runtime);
  // gpuOpenRuns (gpu-compute.js) and the air-layer block depth (segment-runs.js), for a few image sizes and halos
  const openLine = grab(gpuSrc, /const limit=Number\(device\.limits\?\.maxStorageBufferBindingSize\)\|\|134217728,core=[^;]*;/);
  const airLine = grab(srSrc, /const fit=Math\.floor\(limit\/\(w\*h\*4\)\)-2\*halo-1;if\(fit>blockDepth\)blockDepth=Math\.min\(32,fit\);/);
  const open = new Function('device', 'plane', 'halo', openLine + 'return core;'), air = new Function('limit', 'w', 'h', 'halo', 'blockDepth', airLine + 'return blockDepth;');
  const cores = [];
  for (const side of [256, 512, 1024, 2048]) for (let halo = 0; halo <= 40; halo++) {
    cores.push(open({ limits }, side * side, halo), air(limits.maxStorageBufferBindingSize || 134217728, side, side, halo, 4));
  }
  return { ...f, maxOut: Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize || limits.maxStorageBufferBindingSize) >= 256 * MiB, cores };
};
describe('sizes derived from the device limits are unchanged on every profile', () => {
  const { gpuDeviceRequestDescriptor } = api();
  for (const [name, p] of Object.entries(PROFILES)) {
    it(name, () => {
      const req = gpuDeviceRequestDescriptor(adapterOf(p)).requiredLimits, old = oldDescriptor(adapterOf(p)).requiredLimits;
      for (const [desktop, touch] of [[true, 0], [false, 0], [false, 5]]) expect(derived(req, desktop, touch)).toEqual(derived(old, desktop, touch));
    });
  }
  it('opening / air-layer block depth follows the binding limit (4 GiB - 4 gives the pre-508 depth, 2 GiB - 4 thinner blocks)', () => {
    // core = min(32, floor(binding / (plane*4)) - 2*halo - 1): 4 GiB -> 64 - 2h - 1, 2 GiB -> 32 - 2h - 1 (retry rung).
    // Blocks are exact (halo covers the filter), so the result is identical; only the blocks get thinner.
    const open = new Function('device', 'plane', 'halo', grab(gpuSrc, /const limit=Number\(device\.limits\?\.maxStorageBufferBindingSize\)\|\|134217728,core=[^;]*;/) + 'return core;');
    expect(open({ limits: { maxStorageBufferBindingSize: 4 * GiB - 4 } }, 4096 * 4096, 2)).toBe(32);
    expect(open({ limits: { maxStorageBufferBindingSize: 2 * GiB - 4 } }, 4096 * 4096, 2)).toBe(26);
    expect(open({ limits: { maxStorageBufferBindingSize: 2 * GiB - 4 } }, 2048 * 2048, 47)).toBe(32); // 2048²: equal up to halo 47
  });
  it('documents the old desktop sizes (block 96 MB, tile 32 MB, mesh depth 32)', () => {
    const d = derived(oldDescriptor(adapterOf(PROFILES['NVIDIA RTX 4070 Ti (Vulkan)'])).requiredLimits);
    expect([d.block, d.tile, d.mesh]).toEqual([96 * MiB, 32 * MiB, 32]);
  });
});

describe('device request retries with lower caps when refused', () => {
  // each requestAdapter returns a fresh adapter; requestDevice refuses any maxBufferSize above `refuseAbove`
  const fakeGpu = (limits, refuseAbove) => {
    const log = [];
    return {
      log, gpu: {
        async requestAdapter(opts) {
          log.push('adapter ' + (opts?.featureLevel || '-'));
          return { features: new Set(['core-features-and-limits']), limits: { ...limits }, info: {},
            async requestDevice(desc) {
              const b = desc.requiredLimits.maxBufferSize;
              log.push('device ' + (b === undefined ? 'default' : b / MiB + 'MB'));
              if (b !== undefined && b > refuseAbove) throw new Error('Failed to create device: VK_ERROR_OUT_OF_DEVICE_MEMORY');
              return { limits: desc.requiredLimits };
            } };
        },
      },
    };
  };
  const nv = PROFILES['NVIDIA RTX 4070 Ti (Vulkan)'].limits;
  const nv8 = big(8 * GiB, 8 * GiB).limits;
  it('first attempt succeeds: one adapter, one device request with the adapter max (NVIDIA 4 GiB - 4), no extra work', async () => {
    const f = fakeGpu(nv, Infinity), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log).toEqual(['adapter core', 'device ' + (4 * GiB - 4) / MiB + 'MB']);
    expect(r.device.limits.maxBufferSize).toBe(4 * GiB - 4);
    expect(rt.limitInfo).toBe('limits buf 4096MB/bind 4096MB (adapter 4096MB/4096MB)');
  });
  it('an 8 GiB adapter is asked for 4 GiB', async () => {
    const f = fakeGpu(nv8, Infinity), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log).toEqual(['adapter core', 'device 4096MB']);
    expect(r.device.limits).toMatchObject({ maxBufferSize: 4 * GiB, maxStorageBufferBindingSize: 4 * GiB - 4 });
    expect(rt.limitInfo).toBe('limits buf 4096MB/bind 4096MB (adapter 8192MB/8192MB)');
  });
  it('a refused 4 GiB request is retried with 2 GiB, on a fresh adapter', async () => {
    const f = fakeGpu(nv8, 2 * GiB), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log).toEqual(['adapter core', 'device 4096MB', 'adapter core', 'device 2048MB']);
    expect(r.device.limits).toMatchObject({ maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB - 4 });
    expect(rt.limitInfo).toMatch(/^limits buf 2048MB\/bind 2048MB \(adapter 8192MB\/8192MB\) · retry 4096MB failed: Failed to create device: VK_ERROR_OUT_OF_DEVICE_MEMORY$/);
  });
  it('NVIDIA (4 GiB - 4, Vulkan refused the adapter max): the first request is the old one, the retry gets 2 GiB', async () => {
    const f = fakeGpu(nv, 2 * GiB), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log).toEqual(['adapter core', 'device ' + (4 * GiB - 4) / MiB + 'MB', 'adapter core', 'device 2048MB']);
    expect(r.device.limits).toMatchObject({ maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB - 4 });
    expect(rt.limitInfo).toMatch(/^limits buf 2048MB\/bind 2048MB \(adapter 4096MB\/4096MB\) · retry 4096MB failed: /);
  });
  it('then 1 GiB', async () => {
    const f = fakeGpu(nv8, 1 * GiB), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log.filter(l => l.startsWith('device'))).toEqual(['device 4096MB', 'device 2048MB', 'device 1024MB']);
    expect(r.device.limits).toMatchObject({ maxBufferSize: 1 * GiB, maxStorageBufferBindingSize: 1 * GiB });
    expect(rt.limitInfo).toMatch(/^limits buf 1024MB\/bind 1024MB \(adapter 8192MB\/8192MB\) · retry 4096MB failed: .* → 2048MB failed: /);
  });
  it('build 520: the retries and the cap that worked are recorded as data for the debug-mode GPU info tab', async () => {
    const f = fakeGpu(nv8, 1 * GiB), rt = {};
    await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(rt.limitInfoLog).toHaveLength(2);
    expect(rt.limitInfoLog[0]).toMatch(/^4096MB failed: /); expect(rt.limitInfoLog[1]).toMatch(/^2048MB failed: /);
    expect(rt.limitInfoCapUsed).toBe('1024MB');
    const g = fakeGpu(nv, Infinity), r2 = {};
    await api(false, { gpu: g.gpu }, r2).requestVrlGpuDevice();
    expect(r2.limitInfoLog).toEqual([]); expect(r2.limitInfoCapUsed).toBe('4096MB');
  });
  it('then with the WebGPU default buffer limits', async () => {
    const f = fakeGpu(nv8, 512 * MiB), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log.filter(l => l.startsWith('device'))).toEqual(['device 4096MB', 'device 2048MB', 'device 1024MB', 'device default']);
    expect(r.device.limits.maxBufferSize).toBeUndefined();
    expect(r.device.limits.maxComputeInvocationsPerWorkgroup).toBe(256);
    expect(rt.limitInfo).toContain('limits buf default/bind default');
  });
  // a device that requestDevice resolves but that is already lost (Chrome: "Device failed at creation")
  const lostFake = (limits, lostAbove, lostInfo, extra = {}) => {
    const log = [], destroyed = [];
    return {
      log, destroyed, gpu: {
        async requestAdapter() {
          return { features: new Set(['core-features-and-limits']), limits: { ...limits }, info: {},
            async requestDevice(desc) {
              const b = desc.requiredLimits.maxBufferSize; log.push('device ' + (b === undefined ? 'default' : b / MiB + 'MB'));
              const lost = b !== undefined && b > lostAbove;
              const d = { limits: desc.requiredLimits, queue: { onSubmittedWorkDone: async () => {} }, lost: lost ? Promise.resolve(lostInfo) : new Promise(() => {}), destroy() { destroyed.push(b); } };
              return { ...d, ...extra };
            } };
        },
      },
    };
  };
  const OOM = { reason: 'unknown', message: 'Device failed at creation: VK_ERROR_OUT_OF_DEVICE_MEMORY' };
  it('a device lost at creation counts as a failed request: destroyed, next cap taken, error text in the status', async () => {
    const f = lostFake(nv8, 2 * GiB, OOM), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log).toEqual(['device 4096MB', 'device 2048MB']);
    expect(f.destroyed).toEqual([4 * GiB]);
    expect(r.device.limits).toMatchObject({ maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB - 4 });
    expect(rt.limitInfo).toMatch(/^limits buf 2048MB\/bind 2048MB \(adapter 8192MB\/8192MB\) · retry 4096MB failed: device lost at creation \(unknown\): Device failed at creation: VK_ERROR_OUT_OF_DEVICE_MEMORY$/);
  });
  it('NVIDIA: 4 GiB - 4 lost at creation -> 2 GiB; further down to 1 GiB and defaults when those are lost too', async () => {
    const f = lostFake(nv, 512 * MiB, OOM), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log).toEqual(['device 4095.9999961853027MB', 'device 2048MB', 'device 1024MB', 'device default']);
    expect(f.destroyed).toEqual([4 * GiB - 4, 2 * GiB, 1 * GiB]);
    expect(r.device.limits.maxBufferSize).toBeUndefined();
    expect(rt.limitInfo).toMatch(/^limits buf default\/bind default .* · retry 4096MB failed: device lost at creation .* → 2048MB failed: device lost at creation .* → 1024MB failed: device lost at creation /);
  });
  it('lost at creation on every cap: throws, status lists every attempt', async () => {
    const f = lostFake(nv8, -1, OOM), rt = {};
    f.gpu.requestAdapter = (orig => async o => { const a = await orig(o); const rd = a.requestDevice; a.requestDevice = async d => { const dev = await rd(d); dev.lost = Promise.resolve(OOM); return dev; }; return a; })(f.gpu.requestAdapter.bind(f.gpu));
    await expect(api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice()).rejects.toThrow('device lost at creation');
    expect(rt.limitInfo).toMatch(/^device request failed · retry 4096MB failed: .* → 2048MB failed: .* → 1024MB failed: .* → default failed: device lost at creation/);
  });
  it('a healthy device (lost never settles) is kept at the first cap; a loss after creation does not lower the cap', async () => {
    const f = lostFake(nv8, Infinity, OOM), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    expect(f.log).toEqual(['device 4096MB']);
    expect(f.destroyed).toEqual([]);
    expect(r.device.limits.maxBufferSize).toBe(4 * GiB);
  });
  it('gpuLostAtCreation: null for a healthy / lost-less device, info for an immediate loss, tolerates a rejecting queue', async () => {
    const { gpuLostAtCreation } = api();
    expect(await gpuLostAtCreation({ lost: new Promise(() => {}) }, 5)).toBeNull();
    expect(await gpuLostAtCreation({}, 5)).toBeNull();
    expect(await gpuLostAtCreation({ lost: Promise.resolve({ reason: 'destroyed', message: 'x' }) }, 5)).toEqual({ reason: 'destroyed', message: 'x' });
    expect(await gpuLostAtCreation({ lost: Promise.resolve(undefined), queue: { onSubmittedWorkDone: () => Promise.reject(new Error('q')) } }, 5)).toEqual({});
  });
  it('throws the last error when every cap is refused (the caller falls back to CPU / WebGL as before)', async () => {
    const f = fakeGpu(nv, -1), rt = {};
    // the default rung has no maxBufferSize; make that one fail too
    f.gpu.requestAdapter = (orig => async o => { const a = await orig(o); const rd = a.requestDevice; a.requestDevice = async d => { if (d.requiredLimits.maxBufferSize === undefined) throw new Error('still refused'); return rd(d); }; return a; })(f.gpu.requestAdapter.bind(f.gpu));
    await expect(api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice()).rejects.toThrow('still refused');
    expect(rt.limitInfo).toMatch(/^device request failed · retry 4096MB failed: .* → 2048MB failed: .* → 1024MB failed: .* → default failed: still refused$/);
  });
  it('S3a: rungs that would repeat the previous request are skipped (adapter limits at or below the next cap)', async () => {
    const small = big(1 * GiB, 1 * GiB).limits, f = fakeGpu(small, -1), rt = {};
    const r = await api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice();
    // 4 GiB / 2 GiB / 1 GiB all ask for exactly 1 GiB: one request, then the defaults
    expect(f.log).toEqual(['adapter core', 'device 1024MB', 'adapter core', 'device default']);
    expect(r.device.limits.maxBufferSize).toBeUndefined();
    expect(rt.limitInfo).toMatch(/^limits buf default\/bind default .* · retry 4096MB failed: [^→]*$/);
    expect(rt.limitRetries).toBe(1);
  });
  it('S3a: every request refused on a small adapter: the error lists each distinct request once', async () => {
    const small = big(1 * GiB, 1 * GiB).limits, f = fakeGpu(small, -1), rt = {};
    f.gpu.requestAdapter = (orig => async o => { const a = await orig(o); const rd = a.requestDevice; a.requestDevice = async d => { if (d.requiredLimits.maxBufferSize === undefined) throw new Error('still refused'); return rd(d); }; return a; })(f.gpu.requestAdapter.bind(f.gpu));
    await expect(api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice()).rejects.toThrow('still refused');
    // (the wrapper throws for the default rung before the fake logs it)
    expect(f.log.filter(l => l.startsWith('device'))).toEqual(['device 1024MB']);
    expect(rt.limitInfo).toMatch(/^device request failed · retry 4096MB failed: .* → default failed: still refused$/);
    expect(rt.limitInfo).not.toMatch(/2048MB|1024MB failed/);
    expect(rt.limitRetries).toBe(2);
  });
  it('S3a: an adapter above every cap still walks all four rungs', async () => {
    const f = fakeGpu(nv8, -1), rt = {};
    f.gpu.requestAdapter = (orig => async o => { const a = await orig(o); const rd = a.requestDevice; a.requestDevice = async d => { if (d.requiredLimits.maxBufferSize === undefined) throw new Error('still refused'); return rd(d); }; return a; })(f.gpu.requestAdapter.bind(f.gpu));
    await expect(api(false, { gpu: f.gpu }, rt).requestVrlGpuDevice()).rejects.toThrow('still refused');
    expect(f.log.filter(l => l.startsWith('device'))).toEqual(['device 4096MB', 'device 2048MB', 'device 1024MB']);
    expect(rt.limitInfo).toMatch(/^device request failed · retry 4096MB failed: .* → 2048MB failed: .* → 1024MB failed: .* → default failed: still refused$/);
  });
  it('S3b: a queue that never answers does not stall the start-up (500 ms bound; 30 ms here)', async () => {
    const { gpuLostAtCreation } = api();
    const never = () => new Promise(() => {});
    const t0 = Date.now();
    expect(await gpuLostAtCreation({ lost: never(), queue: { onSubmittedWorkDone: never } }, 5, 30)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(400);
    // a loss that is reported anyway is still seen
    expect(await gpuLostAtCreation({ lost: Promise.resolve({ reason: 'unknown', message: 'm' }), queue: { onSubmittedWorkDone: never } }, 5, 30)).toEqual({ reason: 'unknown', message: 'm' });
  });
  it('S3b: the default bound is 500 ms', () => {
    expect(gpuSrc).toMatch(/gpuLostAtCreation\(device,settleMs=20,workMs=500\)/);
  });
  it('no adapter: same error as before', async () => {
    await expect(api(false, { gpu: { async requestAdapter() { return null; } } }, {}).requestVrlGpuDevice()).rejects.toThrow('WebGPU adapter unavailable (core and compatibility)');
  });
});

describe('device.lost text', () => {
  const { gpuLostText } = api();
  it('carries the reason and message', () => {
    expect(gpuLostText({ reason: 'unknown', message: 'VK_ERROR_DEVICE_LOST' })).toBe('WebGPU device lost (unknown): VK_ERROR_DEVICE_LOST');
    expect(gpuLostText(undefined)).toBe('WebGPU device lost');
  });
});

// build 515: the setting 「使う GPU」 (gpuPreference) reaches every requestAdapter call of the buffer-limit ladder
describe('GPU preference through the buffer-limit ladder', () => {
  const LINUX = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/155', platform: 'Linux x86_64', maxTouchPoints: 0 };
  const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/155', platform: 'MacIntel', maxTouchPoints: 0 };
  const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', maxTouchPoints: 5 };
  const nvInfo = { vendor: 'nvidia', architecture: 'ada-lovelace' };
  const withSetting = async (value, fn) => {
    const prev = globalThis.__vrlSettings;
    globalThis.__vrlSettings = { get: k => (k === 'gpuPreference' ? value : undefined) };
    try { return await fn(); } finally { if (prev === undefined) delete globalThis.__vrlSettings; else globalThis.__vrlSettings = prev; }
  };
  // every requestAdapter option set is logged; requestDevice refuses every maxBufferSize above `refuseAbove`
  const fake = (nav, refuseAbove, info = nvInfo, adapterFor = () => true) => {
    const opts = [];
    return {
      opts, navigator: { ...nav, gpu: {
        async requestAdapter(o) {
          opts.push(o);
          if (!adapterFor(o)) return null;
          return { features: new Set(['core-features-and-limits']), limits: { ...big(8 * GiB, 8 * GiB).limits }, info,
            async requestDevice(desc) { const b = desc.requiredLimits.maxBufferSize; if (b !== undefined && b > refuseAbove) throw new Error('OOM'); return { limits: desc.requiredLimits }; } };
        } } },
    };
  };
  it('low-power on Linux: all four ladder attempts ask for low-power (4 GiB, 2 GiB, 1 GiB, defaults)', async () => {
    const f = fake(LINUX, 512 * MiB), rt = {};
    await withSetting('low-power', () => api(false, f.navigator, rt).requestVrlGpuDevice());
    expect(f.opts).toEqual([4, 2, 1, 0].map(() => ({ powerPreference: 'low-power', featureLevel: 'core' })));
    expect(rt.limitInfo).toContain('retry 4096MB failed');
  });
  it('high-performance on Windows: same preference on every retry', async () => {
    const win = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155', platform: 'Win32', maxTouchPoints: 0 };
    const f = fake(win, 1 * GiB);
    await withSetting('high-performance', () => api(false, f.navigator, {}).requestVrlGpuDevice());
    expect(f.opts.length).toBe(3);
    expect(f.opts.every(o => o.powerPreference === 'high-performance' && o.featureLevel === 'core')).toBe(true);
  });
  it('the preference is read once: changing the setting mid-ladder does not change later attempts', async () => {
    const f = fake(LINUX, 1 * GiB), rt = {}, mod = api(false, f.navigator, rt);
    let n = 0;
    globalThis.__vrlSettings = { get: () => (n++ === 0 ? 'low-power' : 'high-performance') };
    try { await mod.requestVrlGpuDevice(); } finally { delete globalThis.__vrlSettings; }
    expect(f.opts.map(o => o.powerPreference)).toEqual(['low-power', 'low-power', 'low-power']);
  });
  it('when the first option sets find no adapter, the preference stays in the later ones', async () => {
    const f = fake(LINUX, Infinity, nvInfo, o => o?.featureLevel === 'compatibility' && o.powerPreference), rt = {};
    await withSetting('low-power', () => api(false, f.navigator, rt).requestVrlGpuDevice());
    expect(f.opts).toEqual([{ powerPreference: 'low-power', featureLevel: 'core' }, { powerPreference: 'low-power' }, undefined, { powerPreference: 'low-power', featureLevel: 'compatibility' }]);
  });
  it('Mac / iPad ignore a stored preference: the historical request (high-performance, core), nothing else changes', async () => {
    for (const nav of [MAC, IPAD]) {
      const f = fake(nav, 2 * GiB), rt = {};
      await withSetting('low-power', () => api(false, f.navigator, rt).requestVrlGpuDevice());
      expect(f.opts).toEqual([{ powerPreference: 'high-performance', featureLevel: 'core' }, { powerPreference: 'high-performance', featureLevel: 'core' }]);
      expect(rt.prefInfo).toBe('');
      expect(rt.adapterRequest).toMatchObject({ stored: 'low-power', effective: 'auto', supported: false });
    }
  });
  it('unset / garbage setting is auto (as before)', async () => {
    for (const v of [undefined, 'auto', 'turbo', null, 3]) {
      const f = fake(LINUX, Infinity);
      await withSetting(v, () => api(false, f.navigator, {}).requestVrlGpuDevice());
      expect(f.opts).toEqual([{ powerPreference: 'high-performance', featureLevel: 'core' }]);
    }
  });
  it('status fragment: requested preference, adapter vendor / architecture and the option index that served it', async () => {
    const f = fake(LINUX, Infinity, nvInfo, o => !o?.featureLevel), rt = {};
    await withSetting('high-performance', () => api(false, f.navigator, rt).requestVrlGpuDevice());
    expect(rt.prefInfo).toBe('GPU pref high-performance → nvidia ada-lovelace (request #2)');
    expect(rt.adapterRequest).toMatchObject({ stored: 'high-performance', effective: 'high-performance', supported: true, option: { powerPreference: 'high-performance' }, optionIndex: 1 });
  });
  it('no adapter: the status says so and the old error is thrown', async () => {
    const f = fake(LINUX, Infinity, nvInfo, () => false), rt = {};
    await expect(withSetting('low-power', () => api(false, f.navigator, rt).requestVrlGpuDevice())).rejects.toThrow('WebGPU adapter unavailable (core and compatibility)');
    expect(rt.prefInfo).toBe('GPU pref low-power → no adapter');
  });
  it('the forced compatibility device keeps the preference too', async () => {
    const f = fake(LINUX, Infinity), rt = {};
    await withSetting('low-power', () => build()(true, f.navigator, rt, quiet, ...prefDeps).requestVrlGpuDevice());
    expect(f.opts).toEqual([{ powerPreference: 'low-power', featureLevel: 'compatibility' }]);
  });
});

describe('device request: clip-distances', () => {
  const { gpuDeviceRequestDescriptor } = api();
  it('is requested when the adapter has it (core and compat), limits unchanged', () => {
    for (const core of [true, false]) {
      const p = PROFILES['iPad (Metal)'], plain = adapterOf({ ...p, core }), withClip = { ...plain, features: new Set([...plain.features, 'clip-distances']) };
      const a = gpuDeviceRequestDescriptor(plain), b = gpuDeviceRequestDescriptor(withClip);
      expect(a.requiredFeatures).not.toContain('clip-distances');
      expect(b.requiredFeatures).toEqual([...a.requiredFeatures, 'clip-distances']);
      expect(b.requiredLimits).toEqual(a.requiredLimits);
    }
  });
});
