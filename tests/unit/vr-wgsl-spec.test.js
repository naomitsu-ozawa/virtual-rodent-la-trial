// The specialised volume program (A4, docs/vr-wgsl-spec.js): the text (override declarations, no uniform read of a specialised value left), the settings signature (canonical), the constants the pipeline is made with, the key that
// tells two pipelines apart, the pipeline cache, the host (display switch off by default; on: the generic program draws until the specialised pipeline is ready; passes with overrides stay generic), and the breakdown's 'specCfg' variant
// (registration, the shadow pass, the comparison and the build time in the record). CI has no GPU: the host runs on a mock device. The compile and the pixel comparison of the generic and the specialised program were run by hand on Chromium's
// WebGPU over SwiftShader (f32 variants only: that adapter has no shader-f16), with a throw-away script that is not in the repository.
import { describe, it, expect, vi } from 'vitest';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, uniformLayout, UNIFORM_FIELDS } from '../../docs/vr-wgsl-core.js';
import { SPEC_FIELDS, SPEC_OVERRIDES, SPEC_LEN, SPEC_DISPLAY_DEFAULT, specSigFrom, specSigOfUniforms, specSigOfPacked, specConstants, specKey, specializeVolumeWgsl, volumeSpecWgsl, createSpecPipelines } from '../../docs/vr-wgsl-spec.js';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import { createVolBreakdown, volBreakdownReport, BD_VARIANTS, BD_SPECS } from '../../docs/vr-perf-log.js';

const VARIANTS = [];
for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const events of [false, true]) VARIANTS.push({ f16, cls4, events });

// a session's values: slots shown (segA.w), channels (clsChan), simple flags (segC.w)
const v4 = (x, y, z, w) => ({ x, y, z, w });
const U = (o = {}) => ({
  diag: { value: 0 }, refine: { value: 1 }, useSkip: { value: 0 }, jumpOn: { value: 1 }, editMask: { value: 0 }, editMaskOnly: { value: 0 }, boxEntry: { value: 1 }, capOn: { value: 1 }, planeCount: { value: 0 }, planeCut: { value: 0 },
  clsChan: { value: v4(0, 1, -1, -1) }, segA: { value: [0, 1, 2, 3].map(i => v4(0, 1, 1, i < 2 ? 1 : 0)) }, segC: { value: [0, 1, 2, 3].map(() => v4(1, 1, 1, 0)) }, ...o,
});
const sigOf = (u, extra = null) => Array.from(specSigOfUniforms(u, extra));

describe('A4 the specialised text: override constants for the per-frame settings', () => {
  it.each(VARIANTS)('f16=$f16 cls4=$cls4 events=$events: parses, declares the 18 overrides without a default, reads no specialised value from the uniform buffer, keeps the entry points', v => {
    const src = volumeSpecWgsl(v);
    expect(src).not.toMatch(/undefined|NaN|\$\{|\$1/);
    const r = new WgslReflect(src);
    expect(r.entry.vertex.map(e => e.name)).toEqual(['vs']); expect(r.entry.fragment.map(e => e.name)).toEqual(['fs']);
    expect(r.overrides.map(o => o.name)).toEqual(SPEC_OVERRIDES);
    for (const n of SPEC_OVERRIDES) expect(src).toContain('override ' + n + ':i32;'); // no default: a pipeline made without the constant fails instead of running specialised on a wrong value
    expect(src).not.toMatch(/\bu\.(diag|refine|useSkip|jumpOn|editMask|editMaskOnly|clsChan|boxEntry|capOn|planeCount|planeCut)\b/);
    expect(src).not.toMatch(/u\.segA\[\w+\]\.w|u\.segC\[\w+\]\.w/);
    expect(src).toContain(' spec=cfg\n'); // the header line says which text it is
    // the uniform struct is the generic one (the packer, the layout and the bind group are shared)
    const u = r.uniforms.find(x => x.name === 'u'); expect(u.members.map(m => m.name)).toEqual(UNIFORM_FIELDS.map(f => f[0]));
  });
  it('the values that stay uniform are still read from it (continuous values and per-pass values)', () => {
    const src = volumeSpecWgsl({ events: false });
    for (const f of ['u.stepSize', 'u.texDims', 'u.halfExt', 'u.calib', 'u.voxelSize', 'u.boxH', 'u.proxyOn', 'u.proxyOrg', 'u.segA[idx].x', 'u.segA[idx].z', 'u.segC[idx].rgb']) expect(src, f).toContain(f);
  });
  it('the selectors are built from the constants: the same one-hot vectors, in the half-precision type of the variant', () => {
    const a = volumeSpecWgsl({ events: false });
    expect(a).toContain('let sel0=vec4<f32>(kSel(0,0),kSel(0,1),kSel(0,2),kSel(0,3));let off0=kOff(0);');
    expect(a).toContain('let sel3=vec4<f32>(kSel(3,0),kSel(3,1),kSel(3,2),kSel(3,3));let off3=kOff(3);');
    expect(a).toContain('fn kSel(s:i32,c:i32)->f32{return select(f32(0.0),f32(1.0),kChan(s)==c);}');
    expect(a).toContain('fn kOff(s:i32)->f32{return select(SEG_OFF,f32(0.0),kChan(s)>=0);}');
    const h = volumeSpecWgsl({ f16: true, events: false });
    expect(h).toContain('let sel1=vec4<f16>(kSel(1,0),'); expect(h).toContain('fn kSel(s:i32,c:i32)->f16{'); expect(h).toContain('fn kOff(s:i32)->f16{return select(SEG_OFF,f16(0.0),kChan(s)>=0);}');
    expect(a).not.toContain('var sel0='); expect(a).toContain('dot(qfc,sel0)-off0'); // the march's own expression
  });
  it('every other line is the generic text: removing the declarations and undoing the substitutions gives the generic variant back', () => {
    for (const v of VARIANTS) {
      const g = volumeWgsl(v), s = specializeVolumeWgsl(g);
      const back = s.replace(/override K_[A-Z0-9]+:i32;\n/g, '').replace(/fn k(Chan|On|Simple|Sel|Off)\([^\n]*\n/g, '').replace(' spec=cfg\n', '\n')
        .replace(/K_DIAG/g, 'u.diag').replace(/K_REFINE/g, 'u.refine').replace(/K_SKIP/g, 'u.useSkip').replace(/K_JUMP/g, 'u.jumpOn').replace(/K_EDITONLY/g, 'u.editMaskOnly').replace(/K_EDIT/g, 'u.editMask').replace(/K_BOXENT/g, 'u.boxEntry').replace(/K_CAP/g, 'u.capOn').replace(/K_PLANECUT/g, 'u.planeCut').replace(/K_PLANES/g, 'u.planeCount')
        .replace(/kChan\((\w+)\)/g, 'u.clsChan[$1]').replace(/kOn\((\w+)\)/g, 'u.segA[$1].w>0.5').replace(/kSimple\((\w+)\)/g, 'u.segC[$1].w>0.5');
      const lines = (t, drop) => t.split('\n').filter(l => !drop.test(l));
      // only the selector block differs (its lines are rebuilt)
      expect(lines(back, /^ (let sel0=|var sel0=|\{let c=u\.clsChan\[\d\];if\(c>=0&&u\.segA\[\d\]\.w>0\.5\)\{sel)/)).toEqual(lines(g, /^ (var sel0=|\{let c=u\.clsChan\[\d\];if\(c>=0&&u\.segA\[\d\]\.w>0\.5\)\{sel)/));
    }
  });
  it('an anchor that is not found (the core\'s text changed) throws instead of leaving a uniform read behind', () => {
    const g = volumeWgsl({ events: false });
    expect(() => specializeVolumeWgsl(g.replace('u.refine', 'u.refine2'))).toThrow(/u\.refine found 0 times/);
    expect(() => specializeVolumeWgsl(g.replace('u.jumpOn==0', 'u.jumpOn==0||u.jumpOn==2'))).toThrow(/u\.jumpOn found 2 times/);
    expect(() => specializeVolumeWgsl('fn x(){}')).toThrow();
  });
  it('the display variant\'s text is untouched by this file (volumeWgsl is the generic program, character for character)', () => {
    for (const v of VARIANTS) expect(volumeWgsl(v)).not.toContain('K_DIAG');
  });
});

describe('A4 the signature, the constants and the key', () => {
  it('a normal session: the fields, the constants of each override, the key', () => {
    const sig = sigOf(U());
    expect(SPEC_FIELDS).toHaveLength(SPEC_LEN); expect(SPEC_OVERRIDES).toHaveLength(SPEC_LEN);
    expect(sig).toEqual([0, 1, 0, 1, 0, 0, 0, 1, -1, -1, 0, 0, 0, 0, 1, 1, 0, 0]);
    expect(specConstants(sig)).toEqual({ K_DIAG: 0, K_REFINE: 1, K_SKIP: 0, K_JUMP: 1, K_EDIT: 0, K_EDITONLY: 0, K_CH0: 0, K_CH1: 1, K_CH2: -1, K_CH3: -1, K_SIM0: 0, K_SIM1: 0, K_SIM2: 0, K_SIM3: 0, K_BOXENT: 1, K_CAP: 1, K_PLANES: 0, K_PLANECUT: 0 });
    expect(specKey(sig)).toBe('0.1.0.1.0.0.0.1.-1.-1.0.0.0.0.1.1.0.0');
  });
  it('a pass\'s own values win over the session\'s (the extras of passExtra, the overrides of a diagnostic pass), like the packer', () => {
    expect(sigOf(U(), { jumpOn: 0, useSkip: 1 }).slice(0, 4)).toEqual([0, 1, 1, 0]);
    expect(sigOf(U({ diag: { value: 3 } }), { diag: 5 })[0]).toBe(5);
    expect(sigOf(U({ diag: { value: 3 } }))[0]).toBe(3);
  });
  it('canonical: a hidden slot\'s channel and simple flag do not matter; a shown slot without a channel is hidden; the mask bits are those of the four slots', () => {
    const a = U({ clsChan: { value: v4(2, 7, 1, 3) }, segA: { value: [v4(0, 1, 1, 1), v4(0, 1, 1, 0), v4(0, 1, 1, 1), v4(0, 1, 1, 0)] }, segC: { value: [v4(1, 1, 1, 1), v4(1, 1, 1, 1), v4(1, 1, 1, 0), v4(1, 1, 1, 1)] } });
    expect(sigOf(a).slice(6, 14)).toEqual([2, -1, 1, -1, 1, 0, 0, 0]);
    const b = U({ clsChan: { value: v4(2, -1, 1, -1) }, segA: { value: [v4(0, 1, 1, 1), v4(0, 1, 1, 1), v4(0, 1, 1, 1), v4(0, 1, 1, 1)] }, segC: { value: [v4(1, 1, 1, 1), v4(1, 1, 1, 1), v4(1, 1, 1, 0), v4(1, 1, 1, 1)] } });
    expect(sigOf(b).slice(6, 14)).toEqual([2, -1, 1, -1, 1, 0, 0, 0]); // slots 1 and 3 are shown but have no channel: like hidden ones
    expect(specKey(sigOf(a))).toBe(specKey(sigOf(b)));
    expect(sigOf(U({ editMask: { value: 0x35 }, editMaskOnly: { value: 0xf2 } })).slice(4, 6)).toEqual([5, 2]);
    expect(sigOf(U({ clsChan: { value: v4(4, 0, 0, 0) } }))[6]).toBe(-1); // a channel past 3 is no channel
    expect(sigOf(U({ planeCount: { value: 14 }, planeCut: { value: 0xfffff } })).slice(16)).toEqual([10, 1023]); // ten planes at most
    expect(sigOf(U({ planeCount: { value: -3 } }))[16]).toBe(0);
  });
  it('missing values read as 0, like the packer\'s zeroed buffer; vectors may be arrays', () => {
    expect(sigOf({})).toEqual([0, 0, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const arr = { clsChan: { value: [1, 0, 3, 2] }, segA: { value: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 0.4]] }, segC: { value: [[0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 1]] } };
    expect(sigOf(arr).slice(6, 14)).toEqual([1, 0, 3, -1, 1, 0, 1, 0]);
  });
  it('the signature read from the packed uniform buffer is the one read from the values (the display pass and the breakdown\'s snapshot agree)', () => {
    const L = uniformLayout(), ab = new ArrayBuffer(L.byteSize), i32 = new Int32Array(ab), f32 = new Float32Array(ab), at = n => L.fields.find(f => f.name === n);
    const cases = [U(), U({ diag: { value: 4 }, refine: { value: 0 }, editMask: { value: 6 }, editMaskOnly: { value: 2 }, boxEntry: { value: 0 }, capOn: { value: 0 }, planeCount: { value: 3 }, planeCut: { value: 5 }, clsChan: { value: v4(3, 2, 1, 0) }, segA: { value: [0, 1, 2, 3].map(() => v4(0, 1, 1, 1)) }, segC: { value: [v4(0, 0, 0, 1), v4(0, 0, 0, 0), v4(0, 0, 0, 1), v4(0, 0, 0, 1)] } })];
    for (const u of cases) {
      const extra = { jumpOn: 1, useSkip: 0 };
      i32.fill(0);
      for (const n of ['diag', 'refine', 'editMask', 'editMaskOnly', 'boxEntry', 'capOn', 'planeCount', 'planeCut']) i32[at(n).offset / 4] = u[n].value;
      i32[at('jumpOn').offset / 4] = extra.jumpOn; i32[at('useSkip').offset / 4] = extra.useSkip;
      ['x', 'y', 'z', 'w'].forEach((k, i) => { i32[at('clsChan').offset / 4 + i] = u.clsChan.value[k]; });
      for (let s = 0; s < 4; s++) { f32[at('segA').offset / 4 + s * 4 + 3] = u.segA.value[s].w; f32[at('segC').offset / 4 + s * 4 + 3] = u.segC.value[s].w; }
      expect(Array.from(specSigOfPacked(i32, f32, L))).toEqual(sigOf(u, extra));
    }
  });
  it('the key tells every setting apart: all combinations of the canonical settings give as many keys as distinct canonical signatures', () => {
    const keys = new Set(), canon = new Set();
    for (const diag of [0, 1, 2, 3, 4, 5]) for (const refine of [0, 1]) for (const jump of [0, 1]) for (const skip of [0, 1]) for (const em of [0, 1, 6, 15, 16]) for (const eo of [0, 3]) for (const sec of [[0, 0, 1, 1], [3, 5, 0, 1], [3, 1029, 1, 0], [11, 2, 0, 0]]) for (const chans of [[0, 1, 2, 3], [0, 1, -1, -1], [3, 2, 1, 0], [2, 2, 0, -1]]) for (const shown of [0b1111, 0b0101, 0b0011, 0]) for (const simple of [0, 0b0110]) {
      const u = U({ diag: { value: diag }, refine: { value: refine }, editMask: { value: em }, editMaskOnly: { value: eo }, planeCount: { value: sec[0] }, planeCut: { value: sec[1] }, boxEntry: { value: sec[2] }, capOn: { value: sec[3] }, clsChan: { value: v4(...chans) }, segA: { value: [0, 1, 2, 3].map(i => v4(0, 1, 1, shown >> i & 1)) }, segC: { value: [0, 1, 2, 3].map(i => v4(1, 1, 1, simple >> i & 1)) } });
      keys.add(specKey(sigOf(u, { jumpOn: jump, useSkip: skip })));
      // an independent description of what the shader can tell apart: the usable slots' channels and simple flags
      canon.add([diag, refine, skip, jump, em & 15, eo & 15, ...[0, 1, 2, 3].map(i => (shown >> i & 1 && chans[i] >= 0 ? chans[i] : -1)), ...[0, 1, 2, 3].map(i => (shown >> i & 1 && chans[i] >= 0 && simple >> i & 1 ? 1 : 0)), sec[2], sec[3], Math.min(10, sec[0]), sec[1] & 1023].join('.'));
    }
    expect(keys.size).toBe(canon.size); expect(keys.size).toBeGreaterThan(4000);
    expect(keys).toEqual(canon);
  });
});

describe('A4 the selectors: the constants give the same one-hot vectors, offsets and first-match slot as the generic program\'s per-ray setup', () => {
  // the generic setup (vr-wgsl-core.js): sel[c] = 1, off = 0 for a slot that is shown with a channel c >= 0; else sel = 0, off = SEG_OFF
  const generic = (c, shown) => { const sel = [0, 0, 0, 0]; let off = 1e9; if (c >= 0 && shown) { sel[c] = 1; off = 0; } return { sel, off }; };
  const specKind = (sig, s) => { const ch = sig[6 + s]; return { sel: [0, 1, 2, 3].map(k => (ch === k ? 1 : 0)), off: ch >= 0 ? 0 : 1e9 }; }; // kSel / kOff over the constants
  it('for every channel (-1..3) and shown flag of every slot', () => {
    for (let c = -1; c <= 3; c++) for (const shown of [0, 1]) {
      const sig = sigOf(U({ clsChan: { value: v4(c, c, c, c) }, segA: { value: [0, 1, 2, 3].map(() => v4(0, 1, 1, shown)) } }));
      for (let s = 0; s < 4; s++) expect(specKind(sig, s)).toEqual(generic(c, shown));
    }
  });
  it('the value the march computes (dot(q - 0.5, sel) - off) and the first slot at or above 0 are identical over a grid of class vectors', () => {
    const qs = []; for (const a of [0, 0.2, 0.5, 0.501, 1]) for (const b of [0, 0.49, 0.5, 1]) qs.push([a, b, 1 - a, b / 2]);
    for (const ch of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 1, -1, 0], [-1, -1, -1, -1]]) for (const shown of [0b1111, 0b1010, 0b0001, 0]) {
      const sig = sigOf(U({ clsChan: { value: v4(...ch) }, segA: { value: [0, 1, 2, 3].map(i => v4(0, 1, 1, shown >> i & 1)) } }));
      for (const q of qs) {
        const f = k => (kk => q.reduce((acc, x, i) => acc + (x - 0.5) * kk.sel[i], 0) - kk.off);
        for (let s = 0; s < 4; s++) { const g = generic(ch[s], shown >> s & 1), k = specKind(sig, s); expect(f(0)(k) === f(0)(g)).toBe(true); expect(f(0)(k)).toBe(q.reduce((a, x, i) => a + (x - 0.5) * g.sel[i], 0) - g.off); }
      }
    }
  });
});

describe('A4 the pipeline cache (createSpecPipelines)', () => {
  const mkDevice = (fail = () => false) => {
    const log = { modules: [], pipes: [] };
    const device = { createShaderModule: d => { const m = { code: d.code }; log.modules.push(m); return m; }, createRenderPipelineAsync: async d => { log.pipes.push(d); if (fail(d)) throw new Error('bad constant ' + JSON.stringify(d.fragment.constants)); return { d }; } };
    return { device, log };
  };
  const mk = (device, extra = {}) => createSpecPipelines({ device, makeDesc: (module, constants, v) => ({ v, vertex: { module }, fragment: { module, constants } }), ...extra });
  const V = { cls4: false, events: false }, sigA = sigOf(U()), sigB = sigOf(U({ diag: { value: 3 } })), sigC = sigOf(U({ refine: { value: 0 } }));
  const tick = () => new Promise(r => setTimeout(r, 0));
  it('none -> request -> pending -> ready; one request per key; the fragment stage gets the constants of the key, one module per variant', async () => {
    const { device, log } = mkDevice(); const builds = []; const sp = mk(device, { onBuild: i => builds.push(i) });
    expect(sp.status(V, sigA)).toBe('none'); expect(sp.get(V, sigA)).toBeNull();
    sp.request(V, sigA); sp.request(V, sigA); expect(sp.status(V, sigA)).toBe('pending'); expect(log.pipes).toHaveLength(1);
    expect(log.pipes[0].fragment.constants).toEqual(specConstants(sigA)); expect(log.pipes[0].vertex.constants).toBeUndefined();
    await tick(); expect(sp.status(V, sigA)).toBe('ready'); expect(sp.get(V, sigA).d).toBe(log.pipes[0]);
    expect(builds).toHaveLength(1); expect(builds[0]).toMatchObject({ key: 'c3n|' + specKey(sigA), ok: true }); expect(builds[0].ms).toBeGreaterThanOrEqual(0);
    sp.request(V, sigB); sp.request({ cls4: true, events: false }, sigA); await tick();
    expect(log.pipes.map(p => JSON.stringify(p.fragment.constants))).toHaveLength(3); expect(log.modules).toHaveLength(2); // c3n and c4n; the second key of c3n shares the module
    expect(log.modules[0].code).toBe(volumeSpecWgsl({ f16: false, cls4: false, events: false })); expect(log.modules[1].code).toBe(volumeSpecWgsl({ f16: false, cls4: true, events: false }));
    expect(sp.stats.built).toBe(3); expect(sp.stats.requested).toBe(3);
  });
  it('the keys are separate per setting and per display variant', () => {
    const { device } = mkDevice(); const sp = mk(device);
    expect(new Set([sp.keyOf(V, sigA), sp.keyOf(V, sigB), sp.keyOf(V, sigC), sp.keyOf({ cls4: true, events: false }, sigA), sp.keyOf({ cls4: false, events: true }, sigA)]).size).toBe(5);
  });
  it('a failed build is listed once, never retried, and never ready', async () => {
    const { device, log } = mkDevice(d => d.fragment.constants.K_DIAG === 3); const builds = []; const sp = mk(device, { onBuild: i => builds.push(i) });
    sp.request(V, sigB); await tick(); expect(sp.status(V, sigB)).toBe('failed'); sp.request(V, sigB); await tick(); expect(log.pipes).toHaveLength(1);
    expect(builds[0]).toMatchObject({ ok: false }); expect(builds[0].error).toContain('bad constant'); expect(sp.stats.failed).toBe(1);
  });
  it('a throwing createRenderPipelineAsync is a failed build too', async () => {
    const sp = mk({ createShaderModule: () => ({}), createRenderPipelineAsync: () => { throw new Error('boom'); } }); sp.request(V, sigA); await tick(); expect(sp.status(V, sigA)).toBe('failed');
  });
  it('the cache holds at most `max` pipelines, the least recently used go first', async () => {
    const { device } = mkDevice(); const sp = mk(device, { max: 2 });
    sp.request(V, sigA); await tick(); sp.request(V, sigB); await tick(); sp.get(V, sigA); sp.request(V, sigC); await tick();
    expect(sp.size()).toBe(2); expect(sp.status(V, sigA)).toBe('ready'); expect(sp.status(V, sigB)).toBe('none'); expect(sp.status(V, sigC)).toBe('ready');
  });
  it('pick: null while the pipeline is made (and it is asked for once), then the pipeline; another setting asks again', async () => {
    const { device, log } = mkDevice(); const sp = mk(device), u = U();
    expect(sp.pick(V, u, { jumpOn: 1, useSkip: 0 })).toBeNull(); expect(sp.pick(V, u, { jumpOn: 1, useSkip: 0 })).toBeNull(); expect(log.pipes).toHaveLength(1);
    await tick(); const p = sp.pick(V, u, { jumpOn: 1, useSkip: 0 }); expect(p).toBeTruthy(); expect(sp.pick(V, u, { jumpOn: 1, useSkip: 0 })).toBe(p);
    u.refine.value = 0; expect(sp.pick(V, u, { jumpOn: 1, useSkip: 0 })).toBeNull(); expect(log.pipes).toHaveLength(2);
    u.refine.value = 1; expect(sp.pick(V, u, { jumpOn: 1, useSkip: 0 })).toBe(p); // back to the first settings: its pipeline is still there
  });
});

// ---- the host on a mock device ----
const GPU_GLOBALS = () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
};
const withGpu = fn => async () => { GPU_GLOBALS(); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
const mockGpu = (script, { failSpec = false } = {}) => {
  const log = { passes: [], cmds: [], buffers: [], textures: [], writes: [], shaders: [], pipelines: [], async: [], computePasses: [] };
  const device = { features: new Set(['timestamp-query']), limits: {} };
  device.queue = { writeBuffer: (b, off, data) => { log.writes.push({ b, data: new Int32Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0)) }); }, writeTexture() {}, submit: () => { log.cmds.push('submit'); } };
  device.createQuerySet = d => ({ d, destroy() {} });
  device.createBuffer = d => { const b = { d, vals: [0n, 0n], destroyed: false, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => (d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array(b.vals).buffer), unmap() {} }; log.buffers.push(b); return b; };
  device.createTexture = d => { const t = { d, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({ t }) }; log.textures.push(t); return t; };
  device.createSampler = () => ({}); device.createBindGroupLayout = () => ({}); device.createPipelineLayout = () => ({});
  device.createShaderModule = d => { const m = { code: d.code }; log.shaders.push(d.code); return m; };
  device.createComputePipeline = d => ({ d, compute: true }); device.createComputePipelineAsync = async d => device.createComputePipeline(d);
  device.createRenderPipeline = d => { const p = { d }; log.pipelines.push(p); return p; };
  device.createRenderPipelineAsync = async d => { const p = { d }; log.pipelines.push(p); if (failSpec && d.fragment.constants) throw new Error('constant rejected'); if (d.fragment.constants) log.async.push(p); return p; };
  device.createBindGroup = d => ({ d });
  device.createCommandEncoder = () => ({
    beginRenderPass: d => { const p = { d, pipeline: null, groups: {}, viewports: [], scissors: [], draws: 0 }; log.passes.push(p); log.cmds.push('pass'); return { setPipeline: x => { p.pipeline = x; }, setVertexBuffer() {}, setBindGroup: (i, g) => { p.groups[i] = g; }, setViewport: (...a) => p.viewports.push(a), setScissorRect: (...a) => p.scissors.push(a), draw: () => { p.draws++; }, end() {} }; },
    beginComputePass: d => { const p = { d, pipeline: null, groups: {}, dispatches: [] }; log.computePasses.push(p); log.cmds.push('cpass'); return { setPipeline: x => { p.pipeline = x; }, setBindGroup: (i, g) => { p.groups[i] = g; }, dispatchWorkgroups: (...a) => p.dispatches.push(a), end() {} }; },
    resolveQuerySet() {}, copyBufferToBuffer: (_s, _o, dst, _d, n) => { if (n === 16) dst.vals = script.shift() ?? [0n, 0n]; log.cmds.push('copyB' + n); }, clearBuffer: () => log.cmds.push('clear'), copyTextureToBuffer() {}, finish: () => ({}),
  });
  return { device, log };
};
// uniforms of a session whose low pass uses the pre-pass (as the pre-pass tests): jumps valid, a combined texture on the GPU, no section, two shown slots
const hostU = (over = {}) => {
  const tex = new THREEG.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4), 4, 4, 4); tex.format = THREEG.RGBAFormat; tex.type = THREEG.UnsignedByteType; tex.needsUpdate = true;
  return { distInCls: { value: 1 }, useCls: { value: 1 }, diag: { value: 0 }, refine: { value: 1 }, planeCount: { value: 0 }, clsTex: { value: tex }, halfExt: { value: new THREEG.Vector3(1, 1, 1) }, voxelMin: { value: 0.02 }, clsChan: { value: new THREEG.Vector4(0, 1, -1, -1) },
    segA: { value: [0, 1, 2, 3].map(i => new THREEG.Vector4(0, 0, 1, i < 2 ? 1 : 0)) }, segC: { value: [0, 1, 2, 3].map(() => new THREEG.Vector4(1, 1, 1, 0)) }, boxEntry: { value: 1 }, capOn: { value: 1 }, planeCut: { value: 0 }, ...over };
};
const draw = (r, u, extra = {}) => r.draw({ u, cams: [eyeCam(640, 480), eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false }, ...extra });
const frameOf = (r, u, extra) => { draw(r, u, extra); return r.volume.markFrame(); };
const L = uniformLayout(), at = n => L.fields.find(f => f.name === n).offset / 4;
const isMain = w => w.data.length === L.byteSize / 4;
const lowPass = (log, n0) => log.passes.slice(n0).filter(p => p.d.colorAttachments?.length === 2)[0];

describe('A4 host: the display switch', () => {
  it('the code constant is off: the display only ever uses the generic program, no specialised pipeline is asked for', withGpu(async () => {
    expect(SPEC_DISPLAY_DEFAULT).toBe(false);
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    expect(r.volume.spec.display()).toBe(false);
    const n0 = log.pipelines.length; frameOf(r, hostU()); frameOf(r, hostU()); await settle();
    expect(log.async).toHaveLength(0); expect(log.pipelines.slice(n0).every(p => !p.d.fragment.constants)).toBe(true); expect(r.volume.spec.pipelines.stats.requested).toBe(0);
    r.dispose();
  }));
  it('on: the first frame draws the generic program and asks for the pipeline of its settings; once it is ready the low pass (and the periphery pass) use it, with the constants of those settings', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1], specDisplay: true });
    expect(r.volume.spec.display()).toBe(true);
    const generic = () => r.volume.pipeFor({ cls4: false, events: false });
    let n0 = log.passes.length; frameOf(r, hostU(), { fov: true, fp: 0.25, rects: [[160, 120, 480, 360]], band: 8 });
    const first = log.passes.slice(n0).filter(p => p.pipeline); expect(first.length).toBeGreaterThanOrEqual(2); expect(first.every(p => p.pipeline === generic() || p.compute)).toBe(true);
    expect(log.async).toHaveLength(1); await settle();
    const sp = log.async[0]; expect(sp.d.fragment.constants).toEqual(specConstants(sigOf(hostU(), { jumpOn: 1, useSkip: 0 })));
    n0 = log.passes.length; frameOf(r, hostU(), { fov: true, fp: 0.25, rects: [[160, 120, 480, 360]], band: 8 });
    const rendered = log.passes.slice(n0).filter(p => p.d.colorAttachments?.length === 2 && p.draws > 0); expect(rendered.length).toBe(2); // low + periphery
    expect(rendered.every(p => p.pipeline === sp)).toBe(true); expect(log.async).toHaveLength(1);
    r.dispose();
  }));
  it('a changed setting draws generic until its own pipeline is ready (a shown slot turned off; a second request only for a setting not seen), and the old settings find theirs again', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1], specDisplay: true });
    frameOf(r, hostU()); await settle(); const a = log.async[0];
    const u2 = hostU(); u2.segA.value[1].w = 0; // slot 1 hidden (e.g. a part held)
    let n0 = log.passes.length; frameOf(r, u2); expect(log.async).toHaveLength(2); expect(lowPass(log, n0).pipeline).toBe(r.volume.pipeFor({ cls4: false, events: false }));
    await settle(); n0 = log.passes.length; frameOf(r, u2); expect(lowPass(log, n0).pipeline).toBe(log.async[1]); expect(log.async[1].d.fragment.constants.K_CH1).toBe(-1);
    n0 = log.passes.length; frameOf(r, hostU()); expect(lowPass(log, n0).pipeline).toBe(a); expect(log.async).toHaveLength(2);
    r.dispose();
  }));
  it('a pass with overrides (the diag 5 probe) keeps the generic program even when the switch is on and the pipeline is ready; so does a pass with a pipeline of its own', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1], specDisplay: true });
    const u = hostU(); frameOf(r, u); await settle(); const target = r.volume.getTarget(64, 64), eye = { x: 0, y: 0, w: 48, h: 48, mvp: new THREEG.Matrix4(), origin: new THREEG.Vector3(), lightOff: new THREEG.Vector3() };
    let n0 = log.passes.length; r.volume.drawPass(target, [eye], u, { cls4: false, events: false }, 3, { diag: 5 }, null);
    expect(log.passes[n0].pipeline).toBe(r.volume.pipeFor({ cls4: false, events: false }));
    const own = { own: true }; n0 = log.passes.length; r.volume.drawPass(target, [eye], u, { cls4: false, events: false }, 3, null, null, { pipeline: own }); expect(log.passes[n0].pipeline).toBe(own);
    n0 = log.passes.length; r.volume.drawPass(target, [eye], u, { cls4: false, events: false }, 3, null, null); expect(log.passes[n0].pipeline).toBe(log.async[0]); // the same pass without overrides does use it
    r.dispose();
  }));
  it('a pipeline that fails to build leaves the display on the generic program for good (no retry), and tells the breakdown\'s record', withGpu(async () => {
    const { device, log } = mockGpu([], { failSpec: true });
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1], specDisplay: true });
    const got = []; await r.breakdown.begin({ cls4: false, events: false }, (...a) => got.push(a));
    for (let i = 0; i < 3; i++) { const n0 = log.passes.length; frameOf(r, hostU()); await settle(); expect(lowPass(log, n0).pipeline).toBe(r.volume.pipeFor({ cls4: false, events: false })); }
    expect(log.pipelines.filter(p => p.d.fragment.constants)).toHaveLength(1); expect(got.find(x => x[0] === 'specFail')).toBeTruthy();
    expect(got.find(x => String(x[0]).startsWith('specErr:'))[0]).toMatch(/^specErr:c3n\|[-.\d]+ constant rejected$/); // the reason reaches the record, with the key of the settings
    r.dispose();
  }));
  it('setDisplay switches the display at run time (the program of the pass, not the pipelines)', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    frameOf(r, hostU()); expect(log.async).toHaveLength(0); r.volume.spec.setDisplay(true); frameOf(r, hostU()); await settle(); expect(log.async).toHaveLength(1);
    const n0 = log.passes.length; frameOf(r, hostU()); expect(lowPass(log, n0).pipeline).toBe(log.async[0]);
    r.volume.spec.setDisplay(false); const n1 = log.passes.length; frameOf(r, hostU()); expect(lowPass(log, n1).pipeline).toBe(r.volume.pipeFor({ cls4: false, events: false }));
    r.dispose();
  }));
});

describe('A4 the breakdown\'s specCfg variant', () => {
  it('is registered: the fifth variant, a program (not a uniform) change, away from noProxy', () => {
    { const ten = ['same', 'box', 'simple', 'noGrad', 'specCfg', 'noRefine', 'noShade', 'withCreep', 'noJump', 'noProxy']; expect(BD_VARIANTS.filter(v => ten.includes(v))).toEqual(ten); } // (the order of these ten; the variants of the other groups are registered between them)
    expect(Math.abs(BD_VARIANTS.indexOf('specCfg') - BD_VARIANTS.indexOf('noProxy'))).toBeGreaterThan(1); // the two comparisons share one counter buffer: not on consecutive turns
    expect(BD_SPECS.specCfg).toEqual({ name: 'specCfg', spec: true, diff: true }); expect(BD_SPECS.specCfg.abl).toBeUndefined(); expect(BD_SPECS.specCfg.overrides).toBeUndefined();
    expect(createVolBreakdown().summary().variants.specCfg).toMatchObject({ n: 0 });
  });
  it('the shadow pass: null (and the build started) while the pipeline is not ready; then the specialised program timed into a scratch target, the generic one again into a second, the counting compute, 4 bytes read back as diff:specCfg', withGpu(async () => {
    const { device, log } = mockGpu([[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n], [13_100_000n, 13_200_000n], [20_000_000n, 28_000_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const got = []; const res = await r.breakdown.begin({ cls4: false, events: false }, (...a) => got.push(a)); expect(res.failed).toEqual([]);
    const rb = log.buffers.filter(b => b.d.size === 16 && (b.d.usage & 32)).at(-1); rb.vals = [5n, 0n]; // the comparison's read-back buffer (4 u32 since the generic pixel comparison; this pass reads the first)
    const rec = frameOf(r, hostU()); let np = log.passes.length;
    expect(r.breakdown.shadow(rec, BD_SPECS.specCfg)).toBeNull(); expect(log.passes.length).toBe(np); expect(log.async).toHaveLength(1); // the creation is started, the rotation steps on
    expect(r.breakdown.shadow(rec, BD_SPECS.specCfg)).toBeNull(); expect(log.async).toHaveLength(1); // still being made: not asked again
    await settle();
    const n0 = log.writes.length, nc = log.computePasses.length; np = log.passes.length;
    expect(r.breakdown.shadow(rec, BD_SPECS.specCfg)).toBe(true);
    const w = log.writes.slice(n0).filter(isMain); expect(w).toHaveLength(2); // the low pass's own uniforms (the pre-pass on, as it had it), once per eye, no override
    const packed = Array.from(w[0].data); expect(packed[at('proxyOn')]).toBe(1); expect(packed[at('jumpOn')]).toBe(1); expect(packed[at('diag')]).toBe(0);
    const [spec, gen] = log.passes.slice(np); expect(spec.pipeline).toBe(log.async[0]); expect(gen.pipeline).toBe(r.volume.pipeFor({ cls4: false, events: false }));
    expect(spec.d.timestampWrites).toBeTruthy(); expect(gen.d.timestampWrites).toBeUndefined(); // only the specialised pass is timed
    expect(gen.viewports).toEqual(spec.viewports); expect(gen.scissors).toEqual(spec.scissors); expect(gen.draws).toBe(spec.draws);
    expect(gen.groups[0]).toBe(spec.groups[0]); // the same bind groups: the same uniforms
    expect(gen.d.colorAttachments[0].view.t).not.toBe(spec.d.colorAttachments[0].view.t);
    const cp = log.computePasses[nc]; expect(cp).toBeTruthy(); const ent = cp.groups[0].d.entries;
    expect(ent[0].resource.t).toBe(spec.d.colorAttachments[0].view.t); expect(ent[1].resource.t).toBe(spec.d.colorAttachments[1].view.t); expect(ent[2].resource.t).toBe(gen.d.colorAttachments[0].view.t); expect(ent[3].resource.t).toBe(gen.d.colorAttachments[1].view.t);
    expect(log.cmds.slice(-4)).toEqual(['clear', 'cpass', 'copyB4', 'submit']);
    await settle();
    expect(got.filter(x => x[0] === 'diff:specCfg')).toEqual([['diff:specCfg', 5, 2 * 320 * 240]]);
    const sc = got.find(x => x[0] === 'specCfg'); expect(sc[1]).toBeCloseTo(8); expect(sc[2]).toBeCloseTo(10);
    expect(got.find(x => x[0] === 'specMs')[1]).toBeGreaterThanOrEqual(0);
    expect(got.find(x => String(x[0]).startsWith('specKey:'))[0]).toBe('specKey:c3n|' + specKey(sigOf(hostU(), { jumpOn: 1, useSkip: 0 }))); expect(got.find(x => x[0] === 'specDisplay')).toEqual(['specDisplay', 0, 1]);
    r.dispose();
  }));
  it('a frame of other settings has its own pipeline; a failed build is a step past (null), with the failure told', withGpu(async () => {
    const { device, log } = mockGpu([], { failSpec: true });
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const got = []; await r.breakdown.begin({ cls4: false, events: false }, (...a) => got.push(a));
    const rec = frameOf(r, hostU()); expect(r.breakdown.shadow(rec, BD_SPECS.specCfg)).toBeNull(); await settle();
    expect(r.breakdown.shadow(rec, BD_SPECS.specCfg)).toBeNull(); expect(log.pipelines.filter(p => p.d.fragment.constants)).toHaveLength(1); expect(got.find(x => x[0] === 'specFail')).toBeTruthy();
    r.dispose();
  }));
  it('a recording that begins later is told of the builds made before it (their ms, and a failure with its reason), once', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1], specDisplay: true });
    frameOf(r, hostU()); await settle(); expect(log.async).toHaveLength(1); // built while no recording ran
    const got = []; await r.breakdown.begin({ cls4: false, events: false }, (...a) => got.push(a));
    expect(got.filter(x => x[0] === 'specMs')).toHaveLength(1); expect(got.find(x => x[0] === 'specMs')[1]).toBeGreaterThanOrEqual(0);
    r.breakdown.end(); const got2 = []; await r.breakdown.begin({ cls4: false, events: false }, (...a) => got2.push(a)); expect(got2.filter(x => x[0] === 'specMs')).toHaveLength(1); // a second recording is told again
    r.dispose();
    const m2 = mockGpu([], { failSpec: true }); const r2 = createVrVolumeRenderer({ THREE: THREEG, device: m2.device, halfExt: [1, 1, 1], specDisplay: true });
    frameOf(r2, hostU()); await settle(); const got3 = []; await r2.breakdown.begin({ cls4: false, events: false }, (...a) => got3.push(a));
    expect(got3.find(x => x[0] === 'specFail')).toBeTruthy(); expect(got3.find(x => String(x[0]).startsWith('specErr:'))[0]).toContain('constant rejected');
    r2.dispose();
  }));
  it('a frame that has no snapshot of its own, or a record that is not the snapshot\'s, is not now (false), like the other variants', withGpu(async () => {
    const { device } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    expect(r.breakdown.shadow({}, BD_SPECS.specCfg)).toBe(false); await r.breakdown.begin({ cls4: false, events: false }, () => {}); expect(r.breakdown.shadow({}, BD_SPECS.specCfg)).toBe(false);
    r.dispose();
  }));
});

describe('A4 the record: specCfg in the volume breakdown\'s collector and report', () => {
  it('diff:specCfg / specMs / specFail / specDisplay / specKey are kept apart from the timing variants; the summary and the lines carry them', () => {
    const vb = createVolBreakdown();
    expect(vb.add('same', 10, 10)).toBe(true); expect(vb.add('specCfg', 9, 10)).toBe(true); expect(vb.add('specCfg', 8, 10)).toBe(true);
    expect(vb.add('diff:specCfg', 0, 40000)).toBe(true); expect(vb.add('diff:specCfg', 3, 40000)).toBe(true); expect(vb.add('diff:specCfg', -1, 40000)).toBe(false); expect(vb.add('diff:specCfg', NaN, 40000)).toBe(false); expect(vb.add('diff:specCfg', 1, 0)).toBe(false);
    expect(vb.add('specErr:c3n|0.1 bad constant', 0, 1)).toBe(true); expect(vb.add('specMs', 120, 1)).toBe(true); expect(vb.add('specMs', 80, 1)).toBe(true); expect(vb.add('specMs', NaN, 1)).toBe(false); expect(vb.add('specFail', 5, 1)).toBe(true);
    expect(vb.add('specDisplay', 0, 1)).toBe(true); expect(vb.add('specKey:c3n|0.1.0.1.0.0.0.1.-1.-1.0.0.0.0', 0, 1)).toBe(true);
    const s = vb.summary();
    expect(s.variants.specCfg.n).toBe(2); expect(s.variants.specCfg.R).toBeCloseTo(0.85); expect(s.variants.specCfg.est).toBeCloseTo((1 - 0.85) * 10);
    expect(s.spec).toEqual({ comparisons: 2, withDifference: 1, maxDiffPx: 3, pixels: 40000, buildMs: 100, buildMax: 120, builds: 2, failed: 1, errors: ['c3n|0.1 bad constant'], key: 'c3n|0.1.0.1.0.0.0.1.-1.-1.0.0.0.0', display: false });
    expect(s.proxy.comparisons).toBe(0); // the pre-pass comparison is its own
    const text = vb.lines().join('\n');
    expect(text).toContain('abl specCfg n=2 ratio 0.85');
    expect(text).toContain('specCfg diff px: max 3 of 40000 px · 1 of 2 comparisons had a differing pixel · pipeline build median 100.0 ms, max 120.0 ms (2 built, 1 failed) · display used the generic program · settings c3n|0.1.0.1.0.0.0.1.-1.-1.0.0.0.0 · build errors: c3n|0.1 bad constant');
    expect(volBreakdownReport({ vb, rows: [] }).join('\n')).toContain('note: specCfg = the display\'s low pass drawn with the specialised program');
  });
  it('without any specCfg data the line says so', () => {
    const t = createVolBreakdown().lines().join('\n');
    expect(t).toContain('specCfg diff px: - (no comparison made: the pipeline of the frame\'s settings was not ready, or no read-back) · pipeline build median - (0 failed) · display used -');
  });
});
