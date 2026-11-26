// The new ways of the WebGPU centre pass in the display (distSplit, proxyCoarse, both; code switches, off) and the same-picture check (docs/vr-wgpu-newpath.js, docs/vr-wgpu-ident.js, docs/vr-ident-log.js, the button and the loop in docs/vr-view.js).
// CI has no GPU: the device is a recording mock (tests/helpers/gpu-call-log.js). What is pinned: with the switches off the display's device calls are those of (tests/unit/fixtures/vr-wgpu-display-off-calls.json, made from
// that build's own code), no new GPU object exists; the WGSL texts of the old programs are those of (fixtures/wgsl-hashes-build760.json); the pieces that are plain numbers; the frames that must use the old way; the check's run and record.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, uniformLayout, UNIFORM_FIELDS_ALL, proxyWgsl, proxyDiffWgsl, identDiffWgsl, IDENT_DIFF, identDiffDecode } from '../../docs/vr-wgsl-core.js';
import * as host from '../../docs/vr-wgpu.js';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import * as P from '../../docs/vr-wgpu-coarse-proxy.js';
import * as MR from '../../docs/vr-wgpu-coarse-march.js';
import { newPathText, newPathGate, modeNeeds, NEW_PATH_MODES, createNewPath } from '../../docs/vr-wgpu-newpath.js';
import { identNextMode, IDENT_ROTATION, IDENT_CONTROL_EVERY, IDENT_RING } from '../../docs/vr-wgpu-ident.js';
import * as L from '../../docs/vr-ident-log.js';
import { BENCH_SCENES, BENCH_SEGMENTS, BENCH_PLANS, BENCH_SEGMENT_MS, benchPose, benchSegmentsOf, BENCH_HOLDER_SCALE } from '../../docs/vr-bench.js';
import { GPU_GLOBALS, recordingDevice, runScenario, sceneUniforms, eyeCam, sha16 } from '../helpers/gpu-call-log.js';
import { createHash } from 'node:crypto';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const fixture = f => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));
const sha = t => createHash('sha256').update(t).digest('hex');
const withGpu = fn => async () => { for (const [k, v] of Object.entries(GPU_GLOBALS)) vi.stubGlobal(k, v); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
// the programs go to the GPU through the compile gate (docs/vr-wgpu-gate.js): a few at a time, each job in a task of its own. waitQueue: until every job that waits has started; drain: until nothing is queued or compiling (the other fourth-segment variant's programs are queued behind the waited ones)
const gateOf = r => r.volume.displayNp().inst.gate;
const waitQueue = async (r, ms = 5000) => { for (const g = gateOf(r), t0 = Date.now(); g.queued > 0 && Date.now() - t0 < ms;) await new Promise(x => setTimeout(x, 3)); await settle(); };
const drain = async (r, ms = 8000) => { for (const g = gateOf(r), t0 = Date.now(); g.busy && Date.now() - t0 < ms;) await new Promise(x => setTimeout(x, 3)); await settle(); };
const vrView = read('vr-view.js'), wgpu = read('vr-wgpu.js');

describe('the display has no switch and no way back to the old program', () => {
  it('the switches, their defaults, NEW_PATH_ALLOW_C4 and the stop of the new ways are gone (13 of the plan: the display\'s four entrances take their programs from the table of ways only)', () => {
    for (const k of ['DIST_SPLIT_DISPLAY_DEFAULT', 'COARSE_PROXY_DISPLAY_DEFAULT', 'NEW_PATH_ALLOW_C4']) expect(host[k], k).toBeUndefined();
    for (const w of ['distSplitDisplay', 'coarseDisplay', 'allowC4', 'dnpStop', 'stopNewPath', 'dispMode', 'specOn']) expect(wgpu, w).not.toContain(w);
    expect(wgpu).not.toContain('specs.pick'); // the specialised program is the breakdown's alone (specShadowPass)
    expect(read('vr-wgpu-newpath.js')).not.toContain('modeOfSwitches'); expect(read('vr-wgpu-newpath.js')).not.toContain('WAYS_MADE'); expect(read('vr-wgpu-newpath.js')).not.toContain('noway');
    expect(vrView).not.toContain("newPath.stop(");
  });
  it('the WGSL of the programs that already existed is the text of (character for character): the display variants (vr-breakdown.test.js pins them too), the 8 x 8 pre-pass, the comparison, the grid build (default arguments), the 4 x 4 pre-pass, the coarse volume programs, the march variants', () => {
    const core = { proxy: o => proxyWgsl(o), build: o => P.coarseBuildWgsl(o), coarseProxy: o => P.coarseProxyWgsl(o), coarseVolume: o => P.coarseVolumeWgsl({ f16: o.f16, cls4: o.cls4 }, o.tile), march: o => MR.marchWgsl(volumeWgsl({ f16: o.f16, cls4: o.cls4, events: false }), o.kind), diff: () => proxyDiffWgsl() };
    const table = fixture('wgsl-hashes-build760.json');
    expect(table.length).toBeGreaterThan(30);
    for (const [name, o, hash] of table) expect(sha(core[name](o)), name + ' ' + JSON.stringify(o)).toBe(hash);
  });
  it('the build of a ranged grid differs from the performance record\'s build in one line only (the first thread row), and not at all with the default arguments', () => {
    for (const cls4 of [false, true]) {
      const a = P.coarseBuildWgsl({ cls4 }), b = P.coarseBuildWgsl({ cls4, zRange: true });
      expect(P.coarseBuildWgsl({ cls4, zRange: false })).toBe(a);
      expect(b.replace('let t=vec3<i32>(id)+vec3<i32>(0,0,g.dims.w);', 'let t=vec3<i32>(id);')).toBe(a);
      expect(a).not.toContain('g.dims.w');
    }
  });
  it('no GPU object is made for the new ways by creating the renderer, and the display never asks for the check\'s buffers (9 and up) while no check runs', withGpu(async () => {
    const { device, log } = recordingDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const made = log.filter(l => l.startsWith('create')).length;
    r.dispose();
    expect(made).toBeGreaterThan(0);
    expect(wgpu).toContain("const ident = createIdentGpu({");
    expect(r.volume.newPath.stats().used).toBe(0);
  }));
});

describe('the programs of the new ways', () => {
  const variants = []; for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const mode of NEW_PATH_MODES) variants.push({ f16, cls4, mode });
  it.each(variants)('f16=$f16 cls4=$cls4 $mode: every substitution is found exactly once (no throw), the text parses, and the two substitutions of "both" do not overlap', v => {
    const t = newPathText(v), r = new WgslReflect(t);
    expect(r.entry.vertex.map(e => e.name)).toEqual(['vs']); expect(r.entry.fragment.map(e => e.name)).toEqual(['fs']);
    expect(t).not.toMatch(/undefined|NaN|\$\{/);
    const dist = /march=distSplit/.test(t), coarse = /coarse-tile=4/.test(t);
    expect([dist, coarse]).toEqual([modeNeeds(v.mode).dist, modeNeeds(v.mode).coarse]);
    if (dist) { expect(t).toContain('var dd=textureSampleLevel(distTex,smp,tcS,0.0).r*255.0;'); const g1 = r.getBindGroups()[1]; expect(g1.map(b => b.name).sort()).toEqual(['coarseTex', 'distTex']); }
    else expect(r.getBindGroups()).toHaveLength(1);
    if (coarse) { expect(t).toContain('endT=min(endT,tt.g)'); expect(t).toContain('/4,0).rg;'); } else expect(t).not.toContain('tt.g');
    if (v.mode === 'both') { // the coarse program's text with the distance substitution on top: the two edits sit in different lines
      const c = P.coarseVolumeWgsl({ f16: v.f16, cls4: v.cls4 }, 4), d = MR.marchWgsl(c, 'distSplit');
      expect(d).toBe(t); expect(d.length).toBeGreaterThan(c.length);
    }
    if (v.mode === 'dist') expect(t).toBe(MR.marchWgsl(volumeWgsl({ f16: v.f16, cls4: v.cls4, events: false }), 'distSplit'));
    if (v.mode === 'coarse') expect(t).toBe(P.coarseVolumeWgsl({ f16: v.f16, cls4: v.cls4 }, 4));
  });
  it('the check\'s comparison program parses and its counters are the layout the host decodes', () => {
    const t = identDiffWgsl(), r = new WgslReflect(t);
    expect(r.entry.compute.map(e => e.name)).toEqual(['main']); expect(t).not.toMatch(/undefined|NaN|\$\{/);
    expect(r.getBindGroups()[0].map(b => b.binding).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t).toContain('array<atomic<u32>,' + IDENT_DIFF.total + '>');
    const a = new Uint32Array(IDENT_DIFF.total);
    a[IDENT_DIFF.pixels] = 5; a[IDENT_DIFF.maxColor] = 3; a[IDENT_DIFF.maxDepth] = 7; a[IDENT_DIFF.colorPixels] = 2; a[IDENT_DIFF.minX] = 100 - 10; a[IDENT_DIFF.minY] = 80 - 20; a[IDENT_DIFF.maxX] = 40; a[IDENT_DIFF.maxY] = 50; a[IDENT_DIFF.eye0] = 3; a[IDENT_DIFF.eye1] = 2; a[IDENT_DIFF.cells + 5] = 4; a[IDENT_DIFF.listN] = 2;
    a.set([10, 20, 1, 2, 3, 4], IDENT_DIFF.list); a.set([11, 21, 5, 6, 7, 8], IDENT_DIFF.list + 6);
    const d = identDiffDecode(a, 100, 80);
    expect(d).toMatchObject({ pixels: 5, maxColor: 3, maxDepth: 7, colorPixels: 2, rect: { x0: 10, y0: 20, x1: 40, y1: 50 }, eyes: [3, 2] }); expect(d.cells[5]).toBe(4);
    expect(d.list).toEqual([{ x: 10, y: 20, colA: 1, colB: 2, depA: 3, depB: 4 }, { x: 11, y: 21, colA: 5, colB: 6, depA: 7, depB: 8 }]);
    expect(identDiffDecode(new Uint32Array(IDENT_DIFF.total), 100, 80).rect).toBeNull();
  });
});

describe('4 x 4 tiles: the layout is the shadow pass\'s', () => {
  it('tilesPerEye / tilesY / pxOrg of the new ways are the shadow pass\'s own formulas (e.vx - tile * i * tpe; tpe = ceil(w / tile)), for one and two eyes and several slot sizes', () => {
    for (const [slotW, slotH] of [[256, 256], [250, 130], [1000, 640], [64, 3]]) {
      const t = P.tileLayout(slotW, slotH); expect(t).toEqual({ tilesPerEye: Math.ceil(slotW / 4), tilesY: Math.ceil(slotH / 4) });
      for (const stride of [slotW + 2, slotW + 7]) for (let i = 0; i < 2; i++) {
        const vx = i * stride; expect(P.tilePxOrg(vx, i, t.tilesPerEye)).toEqual([vx - 4 * i * t.tilesPerEye, 0]);
        // (pixel of the target - pxOrg) / 4 = the tile column of the pixel in the eye's block of the tile texture: eye i's columns start at i * tilesPerEye
        for (const x of [0, 1, 3, 4, slotW - 1]) expect(Math.floor((vx + x - P.tilePxOrg(vx, i, t.tilesPerEye)[0]) / 4)).toBe(i * t.tilesPerEye + Math.floor(x / 4));
      }
    }
    expect(P.COARSE_DISPLAY.tile).toBe(4); expect(wgpu).toContain('pxOrg4: tilePxOrg(vx, i, t4.tilesPerEye)'); expect(wgpu).toContain('const t4 = tileLayout(slotW, slotH);');
  });
});

describe('the grid key and the rebuild', () => {
  const base = { clsGen: 3, cls4Gen: 0, segOn: [1, 1, 0, 0], clsChan: [0, 1, -1, -1], dims: [256, 256, 256] };
  it('changes with the combined texture\'s write number, the fourth segment\'s, the shown set, the channels and the size; not with anything else', () => {
    const k = P.coarseGridKey(base);
    for (const o of [{ clsGen: 4 }, { cls4Gen: 1 }, { segOn: [1, 0, 0, 0] }, { clsChan: [0, 1, 2, -1] }, { dims: [256, 256, 128] }]) expect(P.coarseGridKey({ ...base, ...o })).not.toBe(k);
    expect(P.coarseGridKey({ ...base, vol: 99, editGen: 7, uploadGen: 12 })).toBe(k);
    expect(P.coarseGridKey({ ...base, segOn: new Int32Array([1, 1, 0, 0]) })).toBe(k);
  });
  it('the key does not carry the upload stamp of the shadow pass (any texture) nor the every-6th-use rebuild', () => {
    const src = read('vr-wgpu-newpath.js') + wgpu.slice(wgpu.indexOf('const planNewPath'), wgpu.indexOf('const planNewPath') + 1500);
    expect(src).not.toContain('uploadGen'); expect(src).not.toContain('rebuildEvery');
    expect(read('vr-wgpu-coarse-proxy.js').slice(read('vr-wgpu-coarse-proxy.js').indexOf('export function createCoarseDisplay'))).not.toMatch(/uploadGen|rebuildEvery|uses %/);
  });
  it('the tiles of a pass: each slot has its own texture, buffer and bind group (the periphery\'s size never makes the centre\'s over); no grid yet (or no program yet) = no tiles; the programs stay when the resources are reset', withGpu(async () => {
    const rec = recordingDevice(), cd = P.createCoarseDisplay({ device: rec.device, onShader: null, dropGroups: () => {}, name: 'test' });
    const tex = { createView: () => ({}), destroy() {} }, grid = { alpha: tex, marks: tex }, enc = rec.device.createCommandEncoder(), bytes = new Uint8Array(uniformLayout(P.COARSE_FIELDS).byteSize);
    const call = (slot, cols, g = grid) => cd.tiles(enc, { bytes, nEyes: 2, tilesPerEye: cols / 2, tilesY: 8, texCols: cols, texRows: 8, dims: [32, 32, 32], cls4: false, grid: g, slot });
    expect(call('low', 16)).toBeNull(); // the program is not ready
    cd.progs(false); await settle(); await settle(); expect(cd.progs(false).state).toBe('ready');
    expect(call('low', 16, null)).toBeNull();
    const a = call('low', 16), b = call('peri', 8); expect(a).toBeTruthy(); expect(b).toBeTruthy(); expect(a).not.toBe(b);
    expect(call('low', 16)).toBe(a); expect(call('peri', 8)).toBe(b); // the same sizes: the same textures
    expect(rec.stats.textures.filter(t => t.desc.format === 'rg32float')).toHaveLength(2);
    cd.reset(); expect(cd.progs(false).state).toBe('ready'); expect(call('low', 16)).not.toBe(a); // resources made again, the program kept
    cd.destroy();
  }));
});

describe('the walk limit: a frame whose rays cannot reach 4096 iterations may use the new ways that move the ends of the walk', () => {
  it('walkStepsBound = ceil(2 |halfExt| / max(stepSize, 1e-5)) + 2, the limit is 4096 - 16 (a margin), exact at the boundary values', () => {
    const he = [1, 1, 1], diag = 2 * Math.sqrt(3);
    expect(P.walkStepsBound(he, 0.01)).toBe(Math.ceil(diag / 0.01) + 2);
    expect(P.walkStepsBound(he, 0)).toBe(Math.ceil(diag / 1e-5) + 2); // stp = max(stepSize, 1e-5) in the shader
    const s = diag / 4000; // bound = 4000 + 2 (or one more by rounding)
    expect(P.walkLimitOk(he, s)).toBe(true); expect(P.walkLimitOk(he, diag / 4079)).toBe(false); expect(P.walkLimitOk(he, diag / 4077)).toBe(P.walkStepsBound(he, diag / 4077) < 4080);
    let lo = 0.0001, hi = 0.1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (P.walkLimitOk(he, m)) hi = m; else lo = m; } // the smallest step the rule allows: just below it the rule says no, at it yes
    expect(P.walkLimitOk(he, hi)).toBe(true); expect(P.walkLimitOk(he, lo)).toBe(false); expect(P.walkStepsBound(he, hi)).toBe(4079);
    expect(P.walkLimitOk(he, NaN)).toBe(false); expect(P.WALK_LIMIT).toEqual({ iterations: 4096, margin: 16 });
  });
  it('the bound holds: a ray never has more samples t0 + k * stp inside [t0, endT] than the bound (dir unit, t and stepSize one unit), on random boxes, origins, directions and steps', () => {
    let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let worst = 0;
    for (let n = 0; n < 4000; n++) {
      const he = [0.3 + rnd() * 1.5, 0.3 + rnd() * 1.5, 0.3 + rnd() * 1.5], step = Math.max(1e-5, 0.002 + rnd() * 0.05), stp = Math.max(step, 1e-5);
      const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d) || 1, dir = d.map(x => x / l), o = [(rnd() - 0.5) * 8, (rnd() - 0.5) * 8, (rnd() - 0.5) * 8];
      let lo = -Infinity, hi = Infinity;
      for (let a = 0; a < 3; a++) { const inv = 1 / (Math.abs(dir[a]) < 1e-20 ? 1e-20 : dir[a]), t1 = (-he[a] - o[a]) * inv, t2 = (he[a] - o[a]) * inv; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
      if (lo > hi) continue;
      const t0 = Math.max(lo, 0), endT = hi; if (endT < t0) continue;
      const count = Math.floor((endT - t0) / stp) + 1; worst = Math.max(worst, count / P.walkStepsBound(he, step));
      expect(count).toBeLessThanOrEqual(P.walkStepsBound(he, step));
    }
    expect(worst).toBeGreaterThan(0.3); // the test reaches near the bound
  });
  it('the gate (the check\'s explicit ways): a failed instance is refused; the limit is asked only of the ways that move the walk\'s ends (coarse, both), never of distSplit or of tileSkip (its program keeps the loop\'s own limit); c4 is no reason any more', () => {
    const he = [1, 1, 1];
    expect(newPathGate({ mode: 'dist', halfExt: he, stepSize: 0.01 })).toBe('');
    for (const mode of ['coarse', 'both']) { expect(newPathGate({ mode, halfExt: he, stepSize: 0.0008 })).toBe('limit'); expect(newPathGate({ mode, halfExt: he, stepSize: 0.01 })).toBe(''); }
    expect(newPathGate({ mode: 'dist', halfExt: he, stepSize: 0.0008 })).toBe(''); expect(newPathGate({ mode: 'tileSkip', halfExt: he, stepSize: 0.0008 })).toBe('');
    expect(newPathGate({ mode: 'dist', failed: 'x' })).toBe('failed');
  });
});

describe('the distance texture follows the combined texture\'s writes', () => {
  const mkHost = async (size = 16) => {
    const rec = recordingDevice(), h = MR.createMarchHost({ device: rec.device, bgl0: {}, cells: [] });
    const dims = [size, size, size], n = size ** 3, data = new Uint8Array(n * 4); for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >> 5)) & 255;
    const tex = {}; expect(h.prepare(tex, 1, data, dims)).toBe('ready');
    return { rec, h, dims, data, tex, wh: size * size };
  };
  it('a write of slices [z0, z1) puts the alpha bytes of exactly those slices into the distance texture (the same bytes, the same range), nothing else changes, and the host\'s version follows: nothing is made again', withGpu(async () => {
    const { rec, h, dims, data, tex, wh } = await mkHost();
    const distTex = h.state.dist, texCount = rec.stats.textures.length, writes0 = rec.log.filter(l => l.startsWith('writeTexture')).length;
    expect(h.state.builder).toBeNull(); // a display host keeps no CPU copy of the 16 MB texture
    const bytes = data.slice(); for (let z = 4; z < 7; z++) for (let i = 0; i < wh; i++) bytes[(z * wh + i) * 4 + 3] = 200 + z; // new alpha in slices 4..6 (and other bytes too)
    for (let i = 0; i < bytes.length; i++) if (i % 4 !== 3 && i % 5 === 0) bytes[i] ^= 0x55; // the class bytes change too: they are not the distance texture's business
    expect(h.writeRange(tex, 2, bytes, 4, 7)).toBe(true);
    const want = new Uint8Array(3 * wh); for (let z = 4; z < 7; z++) for (let i = 0; i < wh; i++) want[(z - 4) * wh + i] = bytes[(z * wh + i) * 4 + 3]; // exactly the alpha of those slices, in the texture's x / y / z order
    const wts = rec.log.filter(l => l.startsWith('writeTexture')); expect(wts.length).toBe(writes0 + 1);
    const wt = wts[wts.length - 1], [, , ...rest] = wt.split(' '), json = rest.slice(0, -1).join(' '), hash = rest[rest.length - 1];
    expect(JSON.parse(json)).toEqual([[0, 0, 4], [16, 16, 3], 16 * 16 * 3]); expect(hash).toBe(sha16(want));
    expect(h.state.gen).toBe(2); expect(h.prepare(tex, 2, bytes, dims)).toBe('ready'); expect(h.state.dist).toBe(distTex); expect(distTex.destroyed).toBe(false); expect(rec.stats.textures.length).toBe(texCount);
    expect(h.prepare(tex, 3, bytes, dims)).toBe('ready'); expect(distTex.destroyed).toBe(true); expect(h.state.dist).not.toBe(distTex); // a write the host did not follow (another number): made again (16^3: in one step; a bigger texture a slab a frame)
  }));
  it('what it leaves alone: another texture, a texture still being made, bytes that do not fit, and a write too big for one frame (the host is let go and made again by prepare)', withGpu(async () => {
    const { h, data, tex, dims, rec } = await mkHost();
    expect(h.writeRange({}, 2, data, 0, 2)).toBe(false); expect(h.writeRange(tex, 2, data.subarray(0, 100), 0, 2)).toBe(false); expect(h.writeRange(tex, 2, data, 3, 3)).toBe(false); expect(h.writeRange(tex, 2, data, 0, 17)).toBe(false);
    expect(h.state.gen).toBe(1);
    expect(h.writeRange(tex, 2, data, 0, 16, 100)).toBe(false); expect(h.state).toBeNull(); expect(h.prepare(tex, 2, data, dims)).toBe('ready'); // (16^3: the whole is made in one step)
    const rec2 = recordingDevice(), h2 = MR.createMarchHost({ device: rec2.device, bgl0: {}, cells: [] }), big = [64, 64, 64], bytes = new Uint8Array(64 ** 3 * 4);
    expect(h2.prepare({}, 1, bytes, big)).toBe('ready'); // (the step budget covers 64^3)
    void rec;
    const h3 = MR.createMarchHost({ device: recordingDevice().device, bgl0: {}, cells: [] }), t = {}, d3 = [256, 256, 64], b3 = new Uint8Array(256 * 256 * 64 * 4);
    expect(h3.prepare(t, 1, b3, d3)).toBe('wait'); expect(h3.writeRange(t, 2, b3, 0, 2)).toBe(false); // still being made: the version number was not followed, prepare starts again
  }));
  it('a display host has no grid: the grid\'s binding is a 1 x 1 x 1 stand-in, the shadow host\'s group is unchanged (it takes the first cell\'s grid)', withGpu(async () => {
    const { h, rec } = await mkHost(); const g = h.group('distSplit'); expect(g).toBeTruthy();
    const dummy = rec.stats.textures.filter(t => JSON.stringify(t.desc.size) === '[1,1,1]'); expect(dummy.length).toBe(1);
    h.destroy(); expect(dummy[0].destroyed).toBe(true);
    const rec2 = recordingDevice(), s = MR.createMarchHost({ device: rec2.device, bgl0: {} }), data = new Uint8Array(16 ** 3 * 4);
    let r = s.prepare({}, 1, data, [16, 16, 16]); for (let i = 0; i < 50 && r === 'wait'; i++) r = s.prepare(s.state.tex, 1, data, [16, 16, 16]);
    expect(r).toBe('ready'); expect(s.state.coarse.size).toBe(2); s.group('distSplit'); expect(rec2.stats.textures.filter(t => JSON.stringify(t.desc.size) === '[1,1,1]').length).toBe(0);
  }));
});

// ---- the frame: which way a frame is drawn, with the real renderer and the recording device ----
// (bgDelayMs 0: the programs of the other fourth-segment variant are queued at once in these cases: they look at them right after the start)
const mkR = (opts = {}, timestamps = false, dev = {}) => { const rec = recordingDevice({ timestamps, ...dev }); const r = createVrVolumeRenderer({ THREE: THREEG, device: rec.device, halfExt: [1, 1, 1], distSplitDisplay: false, coarseDisplay: false, bgDelayMs: 0, ...opts }); return { r, ...rec }; };
const frameOf = (r, u, over = {}) => r.draw({ u, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 0.5, fov: false, fp: 0.5, rects: null, band: 1, variant: { cls4: false, events: false }, ...over });
// the low pass's way in the log lines of one frame: the program of its first render pass and whether it had a group 1
const lowWay = (rec, from) => {
  const seg = rec.log.slice(from), i = seg.findIndex(l => l.startsWith('render.setPipeline')), id = seg[i].split(' ')[1], code = rec.codeOfPipe(id);
  const own = seg.slice(i, seg.findIndex((l, k) => k > i && l === 'render.end'));
  return { dist: /march=distSplit/.test(code), coarse: /coarse-tile=4/.test(code), group1: own.some(l => l.startsWith('render.setBindGroup 1 ')), pipe: id, tiles4: seg.slice(0, i).filter(l => l.startsWith('compute.dispatch')) };
};
const ready = async (r, u, v = [{ cls4: false, events: false }]) => { await r.preload(u, v); await drain(r); await settle(); await settle(); };

describe('the display with a switch on: a way is chosen for every pass of every frame (chooseWay) and the old way is what is left where no way is made yet', () => {
  it('B: a frame that meets every condition is drawn B (the program of both substitutions, group 1 for the march layout, the 4 x 4 tiles over the coarse grid), and counted', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    let n0 = rec.log.length; frameOf(rec.r, u); let way = lowWay(rec, n0);
    for (let i = 0; i < 4 && !(way.dist && way.coarse); i++) { n0 = rec.log.length; frameOf(rec.r, u); way = lowWay(rec, n0); } // (a frame or two to make the distance texture / the grid)
    expect([way.dist, way.coarse, way.group1]).toEqual([true, true, true]);
    const st = rec.r.volume.newPath.stats(); expect(st.used).toBeGreaterThan(0); expect(st.byWay.B).toBeGreaterThan(0); expect(st.failed).toBe('');
    expect(rec.r.stats.np).toMatchObject({ use: true, mode: 'both', way: 'B' });
    expect(rec.log.slice(n0).filter(l => l.startsWith('compute.dispatch'))).toContain('compute.dispatch ' + Math.ceil(Math.ceil(500 / 4) * 2 / 8) + ',' + Math.ceil(Math.ceil(500 / 4) / 8)); // the 4 x 4 tiles: 125 per eye, two eyes, 125 rows
    rec.r.dispose();
  }));
  it('the frames that are not B: a step too fine for the walk limit and the grid not ready are D (distSplit with the display\'s 8 x 8 pre-pass); diag 2 (the loop count is the picture), the probe (diag 5), diag 1 and a matrix that cannot be inverted are D0 (no pre-pass); a section plane is EvD (distSplit on the section-plane program); no jumps is S (the skip marks)', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 4; i++) frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' });
    const way = (setup, expected, over = {}) => { const bak = {}; setup?.(u, bak); frameOf(rec.r, u, over); expect(rec.r.stats.np, expected.reason ?? expected.way).toMatchObject(expected); setup?.(u, bak, true); };
    way((u2, b, undo) => { u2.stepSize.value = undo ? 0.02 : 0.0008; }, { use: true, way: 'D' });
    way((u2, b, undo) => { u2.diag.value = undo ? 0 : 2; }, { use: true, way: 'D0' });
    way((u2, b, undo) => { u2.diag.value = undo ? 0 : 5; }, { use: true, way: 'D0' });
    way((u2, b, undo) => { u2.diag.value = undo ? 0 : 1; }, { use: true, way: 'D0' });
    way((u2, b, undo) => { u2.planeCount.value = undo ? 0 : 2; }, { use: true, way: 'EvD' });
    way((u2, b, undo) => { u2.distInCls.value = undo ? 1 : 0; }, { use: true, way: 'S', mode: 'genSkip' }); // the combined texture is not in use: the general loop's S
    way((u2, b, undo) => { u2.distInCls.value = undo ? 1 : 0; u2.diag.value = undo ? 0 : 4; }, { use: true, way: 'S', mode: 'genSkip' }); // (whatever the diagnostic)
    way((u2, b, undo) => { u2.diag.value = undo ? 0 : 4; }, { use: true, way: 'OS', mode: 'tileSkip' }); // diag 4 with the combined texture in use: the core's tile walk
    way((u2, b, undo) => { u2.useCls.value = undo ? 1 : 0; }, { use: true, way: 'S', mode: 'genSkipHu' }); // the HU source of the general loop (the classification-off diagnostic): the HU marks' S
    way(null, { use: true, way: 'EvD' }, { variant: { cls4: false, events: true } });
    frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' }); // everything back: B again
    rec.r.dispose();
  }));
  it('the periphery is drawn B too, with tiles of its own: two tile textures (the centre\'s is not made over by the periphery\'s size), a tile compute pass for each, both passes with the coarse program', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    const fov = { fov: true, fp: 0.25, rects: [[300, 300, 700, 700]], band: 8 };
    for (let i = 0; i < 4; i++) frameOf(rec.r, u, fov);
    const n0 = rec.log.length; frameOf(rec.r, u, fov); const seg = rec.log.slice(n0);
    const sets = seg.filter(l => l.startsWith('render.setPipeline')).map(l => rec.codeOfPipe(l.split(' ')[1])); expect(sets).toHaveLength(2); expect(sets.every(c => /coarse-tile=4/.test(c) && /march=distSplit/.test(c))).toBe(true);
    expect(seg.filter(l => l.startsWith('compute.dispatch'))).toHaveLength(2); // one tile compute for the centre, one for the periphery (the grid is made)
    const tex = rec.stats.textures.filter(t => t.desc.format === 'rg32float'); expect(tex).toHaveLength(2); expect(tex[0].desc.size.join('x')).not.toBe(tex[1].desc.size.join('x'));
    const stp = rec.r.volume.newPath.stats(); expect(stp.byWay.B).toBeGreaterThanOrEqual(2);
    rec.r.dispose();
  }));
  it('the scenes of normal use, each in the centre pass AND the periphery pass: the program drawn is one of the ways (B, D, EvD, S, EvS, OS), never the display\'s own text; the probe too', withGpu(async () => {
    const kind = code => (/skip-marks/.test(code) ? (/tile-walk/.test(code) ? 'OS' : /events=true/.test(code) ? 'EvS' : 'S') : /march=distSplit/.test(code) ? (/coarse-tile/.test(code) ? 'B' : /events=true/.test(code) ? 'EvD' : 'D') : 'OLD');
    const fov = { fov: true, fp: 0.25, rects: [[300, 300, 700, 700]], band: 8 };
    const scenes = [
      ['normal', null, {}, 'B', 'B'], ['walk limit (a fine step)', u => { u.stepSize.value = 0.0008; }, {}, 'D', 'D'], ['diag 2', u => { u.diag.value = 2; }, {}, 'D', 'D'], ['diag 1', u => { u.diag.value = 1; }, {}, 'D', 'D'],
      ['diag 5 (the probe as the session\'s diagnostic)', u => { u.diag.value = 5; }, {}, 'D', 'D'], ['section plane', u => { u.planeCount.value = 2; }, { variant: { cls4: false, events: true } }, 'EvD', 'EvD'],
      ['no jumps (no distance field)', u => { u.distInCls.value = 0; }, {}, 'S', 'S'], ['diag 4', u => { u.diag.value = 4; }, {}, 'OS', 'OS'], ['diag 4 and a section plane', u => { u.diag.value = 4; u.planeCount.value = 2; }, { variant: { cls4: false, events: true } }, 'EvS', 'EvS'],
      ['no jumps and diag 2', u => { u.distInCls.value = 0; u.diag.value = 2; }, {}, 'S', 'S'], ['four segments', null, { variant: { cls4: true, events: false } }, 'B', 'B'],
    ];
    for (const [name, setup, over, wantLow, wantPeri] of scenes) {
      const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); setup?.(u);
      await ready(rec.r, u, [{ cls4: !!over.variant?.cls4, events: !!over.variant?.events }]);
      for (let i = 0; i < 4; i++) frameOf(rec.r, u, { ...fov, ...over });
      const n0 = rec.log.length; frameOf(rec.r, u, { ...fov, ...over });
      const kinds = rec.log.slice(n0).filter(l => l.startsWith('render.setPipeline')).map(l => kind(rec.codeOfPipe(l.split(' ')[1])));
      expect(kinds, name).toEqual([wantLow, wantPeri]);
      expect(rec.r.volume.newPath.stats().reasons, name).toEqual({}); // 8-3: no frame of the scene was a pass without a way ('noproxy' and 'textures' cannot happen: every display pass hands its way choice over and the data is on the GPU before the first frame)
      rec.r.dispose();
    }
  }));
  it('the probe (diag 5 pass) is drawn D0 (the distSplit program, no pre-pass), and a session without any way (the switches off) keeps the display\'s own', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 3; i++) frameOf(rec.r, u);
    const n0 = rec.log.length; const pr = rec.r.probe({ u, cam: eyeCam(1000, 1000), model: new THREEG.Matrix4() }); await settle();
    const sp = rec.log.slice(n0).filter(l => l.startsWith('render.setPipeline')); expect(sp).toHaveLength(1); expect(/march=distSplit/.test(rec.codeOfPipe(sp[0].split(' ')[1]))).toBe(true); expect(/coarse-tile/.test(rec.codeOfPipe(sp[0].split(' ')[1]))).toBe(false);
    expect(rec.log.slice(n0).filter(l => l.startsWith('compute.dispatch'))).toEqual([]); void pr;
    rec.r.dispose();
  }));
  it('D0 draws without any pre-pass: no compute pass, proxyOn 0, the distSplit program with group 1', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 4; i++) frameOf(rec.r, u);
    u.diag.value = 1; const n0 = rec.log.length; frameOf(rec.r, u); const w = lowWay(rec, n0);
    expect(rec.r.stats.np).toMatchObject({ use: true, way: 'D0', mode: 'dist' }); expect(w.dist).toBe(true); expect(w.coarse).toBe(false); expect(w.group1).toBe(true);
    expect(rec.log.slice(n0).filter(l => l.startsWith('compute.dispatch'))).toEqual([]);
    rec.r.dispose();
  }));
  it('distSplit is not asked for the walk limit', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true }), u = sceneUniforms(); u.stepSize.value = 0.0008; await ready(rec.r, u);
    for (let i = 0; i < 3; i++) frameOf(rec.r, u); expect(rec.r.stats.np?.use).toBe(true);
    rec.r.dispose();
  }));
  it('the programs of B are not ready yet: D draws, and no frame waits for them', withGpu(async () => {
    const rec = mkR({ coarseDisplay: true }), u = sceneUniforms();
    const slow = rec.device.createRenderPipelineAsync; let release; rec.device.createRenderPipelineAsync = d => (/coarse-tile=4/.test(d.vertex.module.code) ? new Promise(res => { release = () => res(slow(d)); }) : slow(d)); // (the programs of the new way hang until released; the display's own are made as always)
    void rec.r.preload(u, [{ cls4: false, events: false }]); await new Promise(r => setTimeout(r, 150)); await waitQueue(rec.r); // (preload waits for the programs of the ways: this one hangs, so it is not awaited; the frames go on. The jobs that wait start one after the other: the hung programs hold two of the gate's three places)
    for (let i = 0; i < 3; i++) frameOf(rec.r, u); // (the distance texture is made at the first frame)
    const n0 = rec.log.length; frameOf(rec.r, u); expect(lowWay(rec, n0).coarse).toBe(false); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'D' }); // B's program is not there: D (distSplit, the 8 x 8 pre-pass) draws, nothing waits
    rec.r.dispose(); void release;
  }));
  it('preload (the session start, gx.ready) waits for the programs of every way of the variants, and the first frame finds them ready; the other fourth-segment variant is started and not waited for', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(), slow = rec.device.createRenderPipelineAsync, releases = [];
    rec.device.createRenderPipelineAsync = d => (/coarse-tile=4|skip-marks/.test(d.vertex.module.code) ? new Promise(res => { releases.push(() => res(slow(d))); }) : slow(d));
    let done = false; const p = rec.r.preload(u, [{ cls4: false, events: false }]).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 150)); expect(done).toBe(false); expect(releases.length).toBeGreaterThan(0); // (held by the programs of the ways: the gate has three places, the held programs fill them)
    let held = 0; for (let i = 0; i < 600 && !done; i++) { held += releases.length; for (const r of releases.splice(0)) r(); await new Promise(r => setTimeout(r, 4)); } // (released as they come: each release makes room for the next job)
    await p; expect(done).toBe(true);
    expect(held).toBe(8); // c3: B (both), OS (tileSkip), S (skip), EvS (skipEv) and the general loop's S and EvS (genSkip, genSkipEv) and of the HU data (genSkipHu, genSkipHuEv) are the ones held here (the c4 ones are queued after the wait, not waited for)
    for (let i = 0; i < 600 && gateOf(rec.r).busy; i++) { for (const r of releases.splice(0)) r(); await new Promise(r => setTimeout(r, 4)); } // (the c4 programs, started behind the waited ones)
    await settle(); const progs = rec.stats.shaders.filter(c => /march=distSplit|skip-marks/.test(c)); expect(progs.length).toBeGreaterThanOrEqual(8 + 8); // every way of c3, then (queued, not waited for) every way of c4
    frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true);
    rec.r.dispose();
  }));
  it('a compile failure takes away that program\'s ways only (the ladder goes on); one line is kept, nothing is retried every frame', withGpu(async () => {
    const rec = mkR({ coarseDisplay: true }), u = sceneUniforms(), orig = rec.device.createRenderPipelineAsync; let calls = 0;
    rec.device.createRenderPipelineAsync = async d => { if (/coarse-tile=4/.test((d.vertex.module.code))) { calls++; throw new Error('boom'); } return orig(d); };
    await ready(rec.r, u);
    for (let i = 0; i < 4; i++) { const n0 = rec.log.length; frameOf(rec.r, u); expect(lowWay(rec, n0).coarse).toBe(false); }
    const st = rec.r.volume.newPath.stats(); expect(st.failed).toContain('boom'); expect(st.failLog).toHaveLength(1); expect(calls).toBe(4); // (B and OS, c3 and c4: each compiled once, never again)
    expect(rec.r.stats.np).toMatchObject({ use: true, way: 'D' }); // the program that failed fails its own ways only: B falls to D, whose program is fine (a failure does not stop the other ways)
    u.diag.value = 4; for (let i = 0; i < 2; i++) frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'S' }); // OS fell to S the same way
    rec.r.dispose();
  }));
  it('P7: the breakdown\'s recording and the same-picture check do not switch the display off: it draws its way, the old way is their own ruler in their own images (the recording makes the old 8 x 8 tiles in an encoder of its own)', withGpu(async () => {
    const rec = mkR({}, true), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 3; i++) frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' });
    await rec.r.breakdown.begin({ cls4: false, events: false }, () => {});
    let n0 = rec.log.length; frameOf(rec.r, u); expect(lowWay(rec, n0).dist).toBe(true); expect(lowWay(rec, n0).coarse).toBe(true); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' });
    const old8 = 'compute.dispatch ' + Math.ceil(Math.ceil(500 / 8) * 2 / 8) + ',' + Math.ceil(Math.ceil(500 / 8) / 8);
    expect(rec.log.slice(n0).filter(l => l.startsWith('compute.dispatch'))).toContain(old8); // the recording's 8 x 8 tiles (the display\'s own are 4 x 4)
    rec.r.breakdown.end(); n0 = rec.log.length; frameOf(rec.r, u); expect(rec.log.slice(n0).filter(l => l.startsWith('compute.dispatch'))).not.toContain(old8); // nothing of it without a recording
    const begun = rec.r.volume.ident.begin({ cls4: false }); n0 = rec.log.length; frameOf(rec.r, u); expect(lowWay(rec, n0).dist).toBe(true); expect(rec.r.stats.np.use).toBe(true); // (the check is asked for: the display is not the old way)
    await begun; for (let i = 0; i < 3; i++) frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true); rec.r.volume.ident.end(); n0 = rec.log.length; frameOf(rec.r, u); expect(lowWay(rec, n0).dist).toBe(true);
    rec.r.dispose();
  }));
  it('8-1: a GPU error of the display\'s own submit (its error scopes answer) makes the display\'s resources again at the next frame and it draws on with its ways; the third error in a row (two rebuilds that did not help) ends the session; clean frames count the errors from zero', withGpu(async () => {
    let bad = false; const fatals = [];
    const rec = mkR({ onFatal: e => fatals.push(String(e.message)) }, false, { errorScopes: { scopeError: () => bad } }), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 3; i++) frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' });
    const nTex = () => rec.stats.textures.filter(t => t.desc.format === 'r8unorm' && t.desc.dimension === '3d' && t.desc.size[0] > 1).length, t0 = nTex();
    bad = true; frameOf(rec.r, u); await settle(); bad = false; // the frame's own scopes answer an error
    expect(rec.r.volume.newPath.stats().errors).toBe(1); expect(fatals).toEqual([]);
    const n0 = rec.log.length; frameOf(rec.r, u); await settle(); // the next frame makes the resources again
    expect(rec.r.volume.newPath.stats().notes.join()).toContain('made again after a GPU error (1)'); expect(nTex()).toBe(t0 + 1); expect(rec.r.stats.np.use).toBe(true); expect(lowWay(rec, n0).dist).toBe(true); // the distance texture is made again, the way is still a way
    for (let i = 0; i < 2; i++) { bad = true; frameOf(rec.r, u); await settle(); frameOf(rec.r, u); await settle(); } // two more errors: the second and the third in a row (each after a rebuild)
    expect(fatals).toHaveLength(1); expect(fatals[0]).toContain('GPU errors again after 2 rebuilds');
    bad = false;
    // a periphery pass too (two passes a frame) and frames drawn before any answer has come back: one error, however many passes and frames it comes with
    const fv = mkR({ onFatal: e => fatals.push('fv ' + e.message) }, false, { errorScopes: { scopeError: () => bad } }), uf = sceneUniforms(), fovA = { fov: true, fp: 0.25, rects: [[300, 300, 700, 700]], band: 8 }; await ready(fv.r, uf);
    for (let i = 0; i < 3; i++) frameOf(fv.r, uf, fovA);
    const nf0 = fatals.length; bad = true; for (let i = 0; i < 4; i++) frameOf(fv.r, uf, fovA); bad = false; await settle();
    expect(fv.r.volume.newPath.stats().errors).toBe(1); expect(fatals.length).toBe(nf0); // (4 frames, 8 passes, one error)
    for (let i = 0; i < 3; i++) frameOf(fv.r, uf, fovA); await settle(); expect(fv.r.stats.np.use).toBe(true); fv.r.dispose();
    // clean frames: the count starts again
    const ok = mkR({ onFatal: e => fatals.push('x') }, false, { errorScopes: { scopeError: () => bad } }), u2 = sceneUniforms(); await ready(ok.r, u2); frameOf(ok.r, u2);
    bad = true; frameOf(ok.r, u2); await settle(); bad = false; for (let i = 0; i < 100; i++) frameOf(ok.r, u2); expect(ok.r.volume.newPath.stats().errors).toBe(0);
    rec.r.dispose(); ok.r.dispose();
  }));
  it('5-1 (4): a texture that is disposed (a data switch cancelled half way) takes what was made from it: the distance texture and the marks of the display are let go, and the next use of another texture makes them again', withGpu(async () => {
    const rec = mkR(), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 2; i++) frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true);
    const made = f => rec.stats.textures.filter(t => t.desc.format === f && t.desc.dimension === '3d' && t.desc.size[1] > 1), dist = made('r8unorm'), marks = made('rgba8uint');
    expect(dist).toHaveLength(1); expect(marks.length).toBeGreaterThanOrEqual(2); expect(dist[0].destroyed).toBe(false);
    u.clsTex.value.dispose(); // the three.js texture's dispose event
    expect(dist[0].destroyed).toBe(true); expect(marks.every(t => t.destroyed)).toBe(true);
    const u2 = sceneUniforms(); frameOf(rec.r, u2); expect(rec.r.stats.np.use).toBe(true); expect(made('r8unorm')).toHaveLength(2);
    rec.r.dispose();
  }));
  it('8-3 / the no-way pass: a pass that has no way to draw with (the combined texture is not on the GPU) draws nothing and says so; a pass whose program failed ends the session; one that stays that way for 600 frames ends it too', withGpu(async () => {
    const fatals = [], rec = mkR({ onFatal: e => fatals.push(String(e.message)) }), u = sceneUniforms(); await ready(rec.r, u);
    const nu = { ...u, clsTex: { value: null } };
    for (let i = 0; i < 3; i++) frameOf(rec.r, nu); expect(rec.r.stats.np).toMatchObject({ use: false }); expect(fatals).toEqual([]);
    for (let i = 0; i < 600; i++) frameOf(rec.r, nu); expect(fatals).toHaveLength(1); expect(fatals[0]).toContain('no way to draw with');
    rec.r.dispose();
  }));
  it('the marks and the two grids are made once (whole, at the first draw) and follow writes row by row; a tissue switch (the shown set, the channels) and the write of any other texture make nothing again, and the frame after a switch is B at once', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(48), marksBuilds = () => rec.log.filter(l => /^compute\.dispatch \d+,\d+,\d+$/.test(l)).length - rec.log.filter(l => l.startsWith('copyBufferToTexture')).length;
    await ready(rec.r, u);
    frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' }); const b1 = marksBuilds(); expect(b1).toBe(1); // (one whole build of the marks and the alpha grid, in the first frame: B draws at once, no frames of D while a grid is made)
    for (const k of ['vol', 'editTex', 'sliceVol']) { u[k].value.needsUpdate = true; frameOf(rec.r, u); expect(rec.r.stats.np.way, k).toBe('B'); }
    expect(marksBuilds()).toBe(1);
    u.segA.value[1].w = 0; frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' }); expect(marksBuilds()).toBe(1); // another shown set: nothing is made again
    u.clsChan.value = [1, 0, -1, -1]; frameOf(rec.r, u); expect(rec.r.stats.np.way).toBe('B'); expect(marksBuilds()).toBe(1); // other channels: the same
    u.segA.value[1].w = 1;
    const n0 = rec.log.length; u.clsTex.value.needsUpdate = true; frameOf(rec.r, u); expect(rec.r.stats.np.way).toBe('B'); // the combined texture written whole: the marks follow in the same call (all rows)
    expect(rec.log.slice(n0).filter(l => /^compute\.dispatch \d+,\d+,\d+$/.test(l)).length).toBeGreaterThanOrEqual(2); // (the distance texture's and the marks')
    rec.r.dispose();
  }));
  it('the distance texture follows a partial write of the combined texture (copySlab): the next frame is the new way at once, no distance texture is made again', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true }), u = sceneUniforms(32); await ready(rec.r, u);
    for (let i = 0; i < 2; i++) frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true);
    const r8 = () => rec.stats.textures.filter(t => t.desc.format === 'r8unorm' && t.desc.dimension === '3d').length, n = r8();
    const t = u.clsTex.value, data = t.image.data; for (let z = 10; z < 12; z++) for (let i = 0; i < 32 * 32; i++) data[(z * 1024 + i) * 4 + 3] = 77;
    rec.r.volume.copySlab(t, t, { min: { z: 10 }, max: { z: 12 } });
    frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true); expect(r8()).toBe(n);
    const h = rec.r.volume.newPath; void h;
    rec.r.dispose();
  }));
});

describe('the check\'s GPU side', () => {
  it('the ways take turns (same, dist, coarse, both), every 20th comparison is the positive control and the rotation goes on without it', () => {
    let cursor = 0; const seq = [];
    for (let n = 0; n < 45; n++) { const r = identNextMode(n, cursor); cursor = r.cursor; seq.push(r.mode); }
    expect(seq.slice(0, 6)).toEqual(['same', 'dist', 'coarse', 'both', 'same', 'dist']);
    expect(seq.map((m, i) => (m === 'pos' ? i : -1)).filter(i => i >= 0)).toEqual([19, 39]); expect(IDENT_CONTROL_EVERY).toBe(20);
    expect(seq.slice(17, 23)).toEqual(['dist', 'coarse', 'pos', 'both', 'same', 'dist']); // the 20th is the control; the cursor did not move for it
    expect(IDENT_ROTATION).toEqual(['same', 'dist', 'coarse', 'both']); expect(IDENT_RING).toBe(4);
  });
  const runCheck = async (frames, { ts = false, over = () => ({}), u = sceneUniforms(), cls4 = false, dev = { echo: {}, errorScopes: {} } } = {}) => {
    const rec = mkR({}, ts, dev), results = []; await ready(rec.r, u);
    const ok = await rec.r.volume.ident.begin({ cls4, onResult: r => results.push(r) }); expect(ok.ok, JSON.stringify(ok)).toBe(true);
    for (let i = 0; i < frames; i++) { frameOf(rec.r, u, { identCtx: { phase: 'auto', seg: 'hold/fast', measured: true, sinceSwitch: Infinity, hands: 0, ...over(i) } }); rec.r.volume.markFrame(true); await settle(); }
    await settle(); return { rec, results, u };
  };
  it('a check that runs: one comparison per frame (in flight at most 4), the ways in turn, the new ways used once their programs, distance texture and grid are there, the positive control on the 20th; the display draws the old way meanwhile', withGpu(async () => {
    const { rec, results } = await runCheck(30, { ts: true });
    expect(results.length).toBeGreaterThanOrEqual(26);
    const modes = results.map(r => r.mode); expect(modes.slice(0, 4)).toEqual(['same', 'dist', 'coarse', 'both']); expect(modes[19]).toBe('pos');
    for (const r of results.slice(8)) { if (r.mode === 'pos') expect(r.used).toBe(true); else expect(r.used, r.mode + ' ' + r.why).toBe(true); expect(r.diff.pixels).toBe(0); expect(r.compared).toBe(2 * 500 * 500); }
    expect(rec.r.volume.ident.ready()).toBe(true);
    expect(results.every(r => r.ctx && r.ctx.phase === 'auto')).toBe(true);
    const way = m => results.filter(r => r.mode === m); expect(way('dist').some(r => r.used)).toBe(true);
    // the display's own centre pass is the plain program, never a new way
    const lows = rec.log.filter(l => l.startsWith('render.setPipeline')); expect(lows.length).toBeGreaterThan(30);
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
  it('a frame that cannot use a way says why (c4: every way is the old way; a section plane); the control `same` is still drawn', withGpu(async () => {
    const u = sceneUniforms(); u.planeCount.value = 1;
    const { rec, results } = await runCheck(10, { u });
    for (const r of results.filter(x => x.mode !== 'same' && x.mode !== 'pos')) { expect(r.used).toBe(false); expect(r.why).toBe('section'); }
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
  it('the check shares nothing with the breakdown: its uniform buffers (9 and up) survive a recording\'s end and are the ones it keeps writing', withGpu(async () => {
    const { rec, results, u } = await runCheck(8);
    const written = new Set(), w0 = rec.device.queue.writeBuffer; rec.device.queue.writeBuffer = (b, o, d) => { written.add(b); return w0(b, o, d); };
    frameOf(rec.r, u, { identCtx: { phase: 'auto', measured: true } }); await settle();
    const size = uniformLayout(UNIFORM_FIELDS_ALL).byteSize, ubufs = [...written].filter(b => b.desc.size === size), before = ubufs.length;
    expect(before).toBeGreaterThanOrEqual(2); const mine = ubufs.filter(b => true);
    await rec.r.breakdown.begin({ cls4: false, events: false }, () => {}); rec.r.breakdown.end();
    written.clear(); frameOf(rec.r, u, { identCtx: { phase: 'auto', measured: true } }); await settle();
    const again = [...written].filter(b => b.desc.size === size);
    expect(mine.every(b => !b.destroyed || !again.includes(b))).toBe(true); // a buffer the check had written is either not destroyed or no longer used
    expect(again.every(b => !b.destroyed)).toBe(true); // nothing the frames write after the recording\'s end was destroyed by it
    expect(results.length).toBeGreaterThan(4);
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
  it('a check whose programs do not compile does not start: begin says so (not ok, with the reason) and nothing is left running; the page keeps the reason and the button pressable (vr-view.js identFail)', withGpu(async () => {
    const rec = mkR(), u = sceneUniforms(); await ready(rec.r, u);
    const orig = rec.device.createComputePipelineAsync; rec.device.createComputePipelineAsync = async d => { if (/same-picture check comparison/.test(d.compute.module.code)) throw new Error('no compute'); return orig(d); };
    const r = await rec.r.volume.ident.begin({ cls4: false }); expect(r.ok).toBe(false); expect(r.failed.join()).toContain('no compute');
    rec.r.volume.ident.end(); expect(rec.r.volume.ident.active).toBe(false);
    expect(vrView).toContain("identFail=(ja?'検査を始められませんでした: ':'The check could not start: ')+r.failed.join('; ').slice(0,160)");
    expect(vrView).toContain("if(identFail){ // the check never started"); expect(vrView).toContain("identDone=false;ui.identLine=identFail;identFail='';");
    rec.r.dispose();
  }));
  it('end() lets everything of the check go (targets, counters, timestamp sets, the new ways\' textures and buffers) and a second begin starts clean', withGpu(async () => {
    const { rec } = await runCheck(12, { ts: true });
    const live = () => rec.stats.textures.filter(t => !t.destroyed).length + rec.stats.buffers.filter(b => !b.destroyed).length;
    const during = live(); rec.r.volume.ident.end(); expect(live()).toBeLessThan(during);
    expect(rec.r.volume.ident.active).toBe(false); expect(rec.r.volume.ident.ready()).toBe(false);
    const after = live(); const ok = await rec.r.volume.ident.begin({ cls4: false }); expect(ok.ok).toBe(true); rec.r.volume.ident.end(); expect(live()).toBe(after);
    rec.r.dispose();
  }));
  it('with a display switch on and a check running there are two instances: separate distance textures, grids and tile textures', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 3; i++) frameOf(rec.r, u);
    const disp = rec.r.volume.newPath; expect(disp.stats().used).toBeGreaterThan(0);
    const ok = await rec.r.volume.ident.begin({ cls4: false }); expect(ok.ok).toBe(true);
    for (let i = 0; i < 6; i++) { frameOf(rec.r, u, { identCtx: { phase: 'auto', measured: true } }); await settle(); }
    const a = rec.r.volume.ident.np, b = a.host.state, c = a.marks.state;
    expect(a.host).toBeTruthy(); expect(b.dist.destroyed).toBe(false); expect(c.grid.tex.destroyed).toBe(false);
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
});

describe('the check: its scenes, run, record and verdict (docs/vr-ident-log.js)', () => {
  it('the bench\'s own lists are unchanged; the check\'s list is the five segments (hold/fast, hold/slow, near/fast, near/slow, far/slow) of 45 s and a sixth of 30 s with the hold scale asked for; far is 1.0 m +- 0.2 m', () => {
    expect(BENCH_SCENES).toEqual([{ id: 'hold', dist: 0.45, distAmp: 0.12 }, { id: 'near', dist: 0.30, distAmp: 0.08 }]);
    expect(BENCH_SEGMENTS.map(s => [s.id, s.scene, s.period, s.ms])).toEqual([['hold/fast', 'hold', 'fast', 45000], ['hold/slow', 'hold', 'slow', 45000], ['near/fast', 'near', 'fast', 45000], ['near/slow', 'near', 'slow', 45000]]);
    expect(BENCH_PLANS).toEqual({ cmp: ['std'], iso: ['asis', 'iso'] });
    expect(L.IDENT_SEGMENTS.map(s => [s.id, s.ms])).toEqual([['hold/fast', 45000], ['hold/slow', 45000], ['near/fast', 45000], ['near/slow', 45000], ['far/slow', 45000], ['hold/fast-held', 30000]]); // the sixth: the hold scene's fast figure drawn the way the display draws while a hand holds the body
    expect(L.IDENT_SEGMENTS.filter(s => s.simHold).map(s => s.id)).toEqual(['hold/fast-held']);
    expect(L.IDENT_SCENES.find(s => s.id === 'far')).toEqual({ id: 'far', dist: 1.0, distAmp: 0.2 }); expect(L.IDENT_SCENES.find(s => s.id === 'hold')).toEqual(BENCH_SCENES[0]);
    expect(BENCH_SEGMENT_MS * 5).toBe(225000);
    const far = L.IDENT_SCENES.find(s => s.id === 'far'), segs = benchSegmentsOf('far', L.IDENT_SEGMENTS), ref = { x: 1, y: 1.5, z: -2, yaw: 0.7 }, fwd = [-Math.sin(ref.yaw), 0, -Math.cos(ref.yaw)];
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 45000; t += 100) { const p = benchPose(far, segs, t, ref).pos, d = [p[0] - ref.x, p[1] - ref.y, p[2] - ref.z], along = d[0] * fwd[0] + d[2] * fwd[2]; lo = Math.min(lo, along); hi = Math.max(hi, along); expect(Math.hypot(...d)).toBeLessThan(1.25); }
    expect(lo).toBeGreaterThan(0.79); expect(hi).toBeLessThan(1.21); expect(hi - lo).toBeGreaterThan(0.3); // 1.0 m +- 0.2 m along the heading
    expect(benchPose(far, segs, 0, ref).scale).toBe(BENCH_HOLDER_SCALE);
  });
  // -- the run --
  const mkRun = (over = {}) => {
    const log = [], tissues = { bone: 0, fat: 1, lung: 2 }, st = { readyAt: 3000, t: 0 };
    const env = { now: () => st.t, can: () => '', enter: () => log.push('enter'), leave: ok => log.push('leave ' + ok), done: (ok, why) => log.push('done ' + ok + ' ' + (why || '')), ready: () => st.t >= st.readyAt, ref: () => ({ x: 0, y: 1.6, z: 0, yaw: 0 }),
      pose: p => log.push(['pose', p.pos.map(v => Math.round(v * 1000) / 1000), p.scale]), segState: () => ({ ...tissues }), setSegMode: (k, j) => { log.push('set ' + k + ' ' + j); tissues[k] = j; }, shownKey: () => Object.keys(tissues).find(k => tissues[k] !== 2) ?? null,
      cue: n => log.push('cue ' + n), progress: p => log.push('progress ' + p.phase), holdStart: () => log.push('holdStart'), ...over };
    const run = L.createIdentRun(env, { budgetMs: 1000 / 72 });
    const advance = (ms, step = 1000 / 72) => { const end = st.t + ms; while (st.t < end) { st.t += step; run.tick(st.t); run.frame(); } };
    return { run, env, log, tissues, st, advance };
  };
  it('prep waits for the GPU side, then 5 segments of 45 s with the body placed by the script, the first shown tissue hidden at the middle of near/fast and far/slow and shown again 2 s later, then 60 s for the hand; the run ends with the tissues as they were', () => {
    const { run, log, tissues, st, advance } = mkRun();
    expect(run.start()).toBe(''); expect(run.start()).toBe('running'); expect(run.phase).toBe('prep'); expect(log[0]).toBe('enter');
    advance(2900); expect(run.phase).toBe('prep'); expect(run.state.measured).toBe(false);
    advance(200); expect(run.phase).toBe('auto');
    const t0 = st.t, seen = []; // follow the tissue switches with their times
    let prev = { ...tissues };
    while (run.phase === 'auto') { advance(1000 / 72 * 3); for (const k of Object.keys(tissues)) if (tissues[k] !== prev[k]) { seen.push([k, tissues[k], Math.round((st.t - t0) / 1000)]); prev[k] = tissues[k]; } }
    expect(seen.map(x => x[0] + x[1])).toEqual(['bone2', 'bone0', 'bone2', 'bone0']); // the first shown tissue, hidden, shown again, in two segments
    expect(seen.map(x => x[2])).toEqual([112, 114, 202, 204]); // near/fast: 90 + 22.5 s; far/slow: 180 + 22.5 s (rounded to the second; three frames a step)
  });
  it('(the same run, exact numbers) the switches come at 112.5 s and 202.5 s of the auto part and 2 s later; the measured flag skips the first 2 s of each segment; segments change every 45 s', () => {
    const { run, log, tissues, st, advance } = mkRun(); run.start(); advance(3100); expect(run.phase).toBe('auto');
    const t0 = st.t - 1000 / 72, events = []; let prev = { ...tissues }, segs = new Set(), meas = [];
    while (run.phase === 'auto') { advance(1000 / 72); for (const k of Object.keys(tissues)) if (tissues[k] !== prev[k]) { events.push([k + tissues[k], (st.t - t0) / 1000]); prev[k] = tissues[k]; } if (run.phase === 'auto') segs.add(run.state.seg); meas.push([(st.t - t0) / 1000, run.state.measured]); }
    expect([...segs]).toEqual(['hold/fast', 'hold/slow', 'near/fast', 'near/slow', 'far/slow', 'hold/fast-held']);
    expect(events.map(e => e[0])).toEqual(['bone2', 'bone0', 'bone2', 'bone0']);
    expect(events[0][1]).toBeCloseTo(90 + 22.5, 0); expect(events[1][1] - events[0][1]).toBeCloseTo(2, 1); expect(events[2][1]).toBeCloseTo(180 + 22.5, 0); expect(events[3][1] - events[2][1]).toBeCloseTo(2, 1);
    const mAt = s => meas.find(m => m[0] >= s)[1]; expect(mAt(1)).toBe(false); expect(mAt(2.5)).toBe(true); expect(mAt(46)).toBe(false); expect(mAt(47.5)).toBe(true);
    expect(run.phase).toBe('hold'); expect(log).toContain('holdStart'); expect(log.filter(l => typeof l === 'string' && l.startsWith('cue')).length).toBeLessThanOrEqual(1);
    advance(60500); expect(run.phase).toBe('done'); expect(tissues).toEqual({ bone: 0, fat: 1, lung: 2 });
    expect(log.slice(-2)).toEqual(['leave true', 'done true ']); expect(log.filter(l => typeof l === 'string' && l.startsWith('cue')).length).toBe(61);
  });
  it('the hold part: the body is put within reach once (the hold scene\'s middle, the largest size), then left to the person; the state says hold and measured', () => {
    const { run, log, advance } = mkRun(); run.start(); advance(3100); while (run.phase === 'auto') advance(1000);
    expect(run.phase).toBe('hold'); expect(run.state).toMatchObject({ phase: 'hold', seg: 'hold', measured: true });
    const poses = log.filter(l => Array.isArray(l)), last = poses[poses.length - 1]; expect(last[2]).toBe(BENCH_HOLDER_SCALE);
    const n = poses.length; advance(5000); expect(log.filter(l => Array.isArray(l)).length).toBe(n); // not driven during the hold part
  });
  it('an abort at any time puts the tissues back (a hidden one that was being shown again included), leaves the view, and says ended early; the run cannot start while it runs; a reason from can() stops it before anything is touched', () => {
    const { run, log, tissues, st, advance } = mkRun(); run.start(); advance(3100);
    while (run.phase === 'auto' && tissues.bone !== 2) advance(500);
    expect(tissues.bone).toBe(2); run.abort(); expect(tissues).toEqual({ bone: 0, fat: 1, lung: 2 }); expect(run.phase).toBe('done'); expect(log.slice(-2)).toEqual(['leave false', 'done false ended early']); expect(run.active).toBe(false);
    run.abort(); expect(log.filter(l => l === 'leave false').length).toBe(1); void st;
    const blocked = mkRun({ can: () => 'busy' }); expect(blocked.run.start()).toBe('busy'); expect(blocked.log).toEqual([]); expect(blocked.run.phase).toBe('idle');
    const noKey = mkRun({ shownKey: () => null }); noKey.run.start(); noKey.advance(3100); while (noKey.run.phase === 'auto') noKey.advance(2000); expect(noKey.log.filter(l => typeof l === 'string' && l.startsWith('set'))).toEqual([]);
  });
  it('prep that never gets ready is not waited for for ever: after the longest wait the run goes on and says so', () => {
    const { run, log, advance } = mkRun({ ready: () => false }); run.start(); advance(29000); expect(run.phase).toBe('prep'); advance(2000); expect(run.phase).toBe('auto'); expect(run.reason).toContain('not all ready'); void log;
  });
  // -- the record --
  let frameNo = 100;
  const R = (mode, o = {}) => ({ mode, used: true, why: '', frame: frameNo++, error: '', diff: { pixels: 0, body: 5000, maxColor: 0, maxDepth: 0, colorPixels: 0, rect: null, eyes: [0, 0], cells: new Array(16).fill(0), list: [] }, compared: 500000, ms: { vol: 1, pre: 0.2, build: null }, disp: { vol: 1, pre: 0.2 }, sinceRebuild: 30, ctx: { phase: 'auto', seg: 'hold/fast', measured: true, sinceSwitch: Infinity, switchSeq: 0, simHold: false, hands: 0, cov: 1000, per: 1, f: 0.7, cmps: 20, degps: 150, headM: 0.45, size: 1, t: 1000 }, ...o });
  const feed = (log, { perSeg = 130, held = 130, sw = 12, ways = L.IDENT_WAYS, same = 20, pos = 20, mod = null } = {}) => {
    for (const w of ways) {
      for (const sg of L.IDENT_SEGMENTS) for (let i = 0; i < perSeg; i++) log.add(mod?.(R(w, { ctx: { ...R(w).ctx, seg: sg.id } }), w) ?? R(w, { ctx: { ...R(w).ctx, seg: sg.id } }));
      for (let i = 0; i < held; i++) log.add(R(w, { ctx: { ...R(w).ctx, phase: 'hold', seg: 'hold', hands: 1 } }));
      for (let i = 0; i < sw; i++) log.add(R(w, { ctx: { ...R(w).ctx, seg: 'near/fast', switchSeq: 1 } })); // (frames follow one another: the way is usable again at the first of them)
    }
    for (let i = 0; i < same; i++) log.add(R('same')); for (let i = 0; i < pos; i++) log.add(R('pos', { diff: { ...R('pos').diff, pixels: 40, maxColor: 20 } }));
    return log;
  };
  it('a way with no difference in enough comparisons (all five segments, held, after a tissue switch) is "no difference", with the rule-of-three bound; a way that differed even once is "difference"; too few is "not judged"', () => {
    const ok = feed(L.createIdentLog()), v = ok.verdict();
    expect(v.valid).toBe(true); for (const w of L.IDENT_WAYS) { expect(v.ways[w].state).toBe('none'); expect(v.ways[w].diff).toBe(0); expect(v.ways[w].rate95).toBeCloseTo(3 / v.ways[w].used, 3); }
    expect(v.ways.dist.used).toBe(6 * 130 + 130 + 12);
    const lessSeg = feed(L.createIdentLog(), { perSeg: 99 }); expect(lessSeg.verdict().ways.coarse.state).toBe('notjudged');
    const lessHeld = feed(L.createIdentLog(), { held: 99 }); expect(lessHeld.verdict().ways.dist.state).toBe('notjudged');
    const lessSw = feed(L.createIdentLog(), { sw: 9 }); expect(lessSw.verdict().ways.both.state).toBe('notjudged');
    const few = feed(L.createIdentLog(), { perSeg: 90, held: 10, sw: 3 }); expect(few.verdict().ways.dist.state).toBe('notjudged');
    const lessTotal = feed(L.createIdentLog(), { perSeg: 100, held: 100, sw: 10 }); expect(lessTotal.verdict().ways.dist.used).toBe(710); expect(lessTotal.verdict().ways.dist.state).toBe('none'); // 710 >= 500, 100 each, held 100, switch 10: the numbers of the plan
    const one = feed(L.createIdentLog(), { mod: (r, w) => (w === 'coarse' && r.ctx.seg === 'far/slow' && !r.__d ? (r.__d = true, { ...r, diff: { ...r.diff, pixels: 1, maxColor: 1, maxDepth: 1, colorPixels: 1 } }) : null) });
    const v1 = one.verdict(); expect(v1.ways.coarse.state).toBe('diff'); expect(v1.ways.coarse.diff).toBeGreaterThanOrEqual(1); expect(v1.ways.dist.state).toBe('none');
  });
  it('only comparisons that really used the way count (a frame drawn the old way is listed with its reason), and the first 2 s of a segment (not measured) are not counted at all', () => {
    const log = L.createIdentLog();
    for (let i = 0; i < 10; i++) log.add(R('dist', { used: false, why: 'rebuild', diff: { ...R('dist').diff, pixels: 99 } })); // an unused comparison that differs (the old way vs the old way cannot; it is no evidence about the way)
    for (let i = 0; i < 5; i++) log.add(R('dist', { used: false, why: 'c4' }));
    for (let i = 0; i < 7; i++) log.add(R('dist', { ctx: { ...R('dist').ctx, measured: false } }));
    const t = log.T.dist; expect(t.used).toBe(0); expect(t.diff).toBe(0); expect(t.n).toBe(15); expect(t.notUsed).toEqual({ rebuild: 10, c4: 5 }); expect(log.count).toBe(15);
  });
  it('the control `same` must never differ and the positive control must always differ: otherwise every way is "invalid" (a difference found stays visible), and without a surface search no positive control exists', () => {
    const bad = feed(L.createIdentLog()); bad.add(R('same', { diff: { ...R('same').diff, pixels: 3 } })); let v = bad.verdict();
    expect(v.valid).toBe(false); expect(v.why.join()).toContain('control same'); for (const w of L.IDENT_WAYS) expect(v.ways[w].state).toBe('invalid');
    const noPos = feed(L.createIdentLog()); noPos.add(R('pos', { diff: { ...R('pos').diff, pixels: 0 } })); v = noPos.verdict(); expect(v.valid).toBe(false); expect(v.why.join()).toContain('positive control');
    const none = feed(L.createIdentLog(), { pos: 0 }); v = none.verdict(); expect(v.valid).toBe(false);
    const unav = feed(L.createIdentLog(), { pos: 0 }); for (let i = 0; i < 4; i++) unav.add(R('pos', { used: false, unavailable: true })); v = unav.verdict(); expect(v.valid).toBe(false); expect(v.why.join()).toContain('could not be made');
    const withDiff = feed(L.createIdentLog(), { mod: (r, w) => (w === 'dist' && !r.__d ? (r.__d = true, { ...r, diff: { ...r.diff, pixels: 2 } }) : null) }); withDiff.add(R('same', { diff: { ...R('same').diff, pixels: 1 } })); v = withDiff.verdict(); expect(v.ways.dist.state).toBe('diff'); expect(v.valid).toBe(false);
  });
  it('a c4 session says "no check" for every way (the new ways draw the old way there)', () => {
    const v = feed(L.createIdentLog()).verdict({ cls4: true }); for (const w of L.IDENT_WAYS) expect(v.ways[w].state).toBe('c4');
    expect(L.identReportLines(feed(L.createIdentLog()), { variant: { cls4: true } }).join('\n')).toContain('c4: no check');
  });
  it('the segment of a record: held (a hand holds the body, whatever the part of the run), else the auto segment; the idle part of the hold part belongs to none', () => {
    expect(L.regionOf({ hands: 1, phase: 'auto', seg: 'hold/fast' })).toBe(L.HELD); expect(L.regionOf({ hands: 0, phase: 'auto', seg: 'near/slow' })).toBe('near/slow'); expect(L.regionOf({ hands: 0, phase: 'hold', seg: 'hold' })).toBeNull(); expect(L.regionOf(null)).toBeNull();
    const log = L.createIdentLog(); log.add(R('dist', { ctx: { ...R('dist').ctx, phase: 'auto', seg: 'near/slow', hands: 1 } })); log.add(R('dist', { ctx: { ...R('dist').ctx, phase: 'hold', seg: 'hold', hands: 0 } }));
    expect(log.T.dist.held).toBe(1); expect(log.T.dist.seg).toEqual({}); expect(log.T.dist.used).toBe(2);
  });
  it('the ratios: the check\'s ms over the display\'s of the same frame, the median and quartiles per segment and way, the way\'s median over the control `same` of the same segment; both the centre pass alone and with the pre-pass; segments where the control is more than 10 % from 1 are listed', () => {
    const log = L.createIdentLog();
    for (let i = 0; i < 30; i++) {
      log.add(R('same', { ms: { vol: 2.2, pre: 0.4, build: null }, disp: { vol: 2, pre: 0.4 } }));
      log.add(R('dist', { ms: { vol: 1.1, pre: 0.4 + 0.2 * (i % 2), build: null }, disp: { vol: 2, pre: 0.4 } }));
      log.add(R('coarse', { ms: { vol: 1.5, pre: 0.1, build: 5 }, disp: { vol: 3, pre: 1 } }));
    }
    expect(log.ratio('hold/fast', 'same')).toEqual({ n: 30, med: 1.1, q1: 1.1, q3: 1.1 }); expect(log.ratio('hold/fast', 'dist')).toMatchObject({ med: 0.55, n: 30 }); expect(log.ratio('hold/fast', 'coarse')).toMatchObject({ med: 0.5 });
    expect(log.ratio('hold/fast', 'same', 'vp').med).toBeCloseTo((2.2 + 0.4) / (2 + 0.4), 3); expect(log.ratio('hold/fast', 'coarse', 'vp').med).toBeCloseTo((1.5 + 0.1) / (3 + 1), 3); expect(log.ratio('near/slow', 'dist')).toBeNull();
    const text = L.identReportLines(log).join('\n');
    expect(text).toContain('hold/fast'); expect(text).toMatch(/dist\/ctl/); expect(text).toContain('0.5'); // 0.55 / 1.1 = 0.5
    expect(text).toContain('segments where the control `same` median is further than 10 % from 1'); expect(text).toMatch(/\(the display's own way twice[^)]*\): hold\/fast 1\.1/);
    expect(L.identReportLines(feed(L.createIdentLog())).join('\n')).toMatch(/: none\n/);
  });
  it('the lines: the rows (at most 6000 and then counted as not kept), the differences with their rectangle, eyes, blocks and first pixels (at most 100), the result line of the page in both languages', () => {
    const log = L.createIdentLog({ min: { ...L.IDENT_MIN, rows: 50, diffKeep: 3 } });
    for (let i = 0; i < 60; i++) log.add(R('dist', { diff: { pixels: i < 5 ? 3 : 0, body: 5000, maxColor: 2, maxDepth: 1, colorPixels: 2, rect: { x0: 1, y0: 2, x1: 3, y1: 4 }, eyes: [2, 1], cells: [1, ...new Array(15).fill(0)], list: [{ x: 5, y: 6, colA: 255, colB: 254, depA: 1, depB: 2 }] } }));
    expect(log.rows.length).toBe(50); expect(log.dropped()).toBe(10); expect(log.diffs.length).toBe(3);
    const text = L.identReportLines(log).join('\n'); expect(text).toContain('10 more not kept'); expect(text).toContain('1 2 3 4'); expect(text).toContain('5 6 000000ff 000000fe 00000001 00000002');
    const v = feed(L.createIdentLog()).verdict();
    expect(L.identResultLine(v, true, true)).toBe('完了 差の出た比較 distSplit 0/' + v.ways.dist.used + '・proxyCoarse 0/' + v.ways.coarse.used + '・両方 0/' + v.ways.both.used);
    expect(L.identResultLine(v, false, true).startsWith('途中終了 差の出た比較 distSplit')).toBe(true);
    expect(L.identResultLine(v, true, false)).toBe('Done, comparisons with a difference dist 0/' + v.ways.dist.used + ' · coarse 0/' + v.ways.coarse.used + ' · both 0/' + v.ways.both.used);
    expect(L.identResultLine(v, false, false).startsWith('Ended early, comparisons with a difference dist')).toBe(true);
    const inv = feed(L.createIdentLog()); inv.add(R('same', { diff: { ...R('same').diff, pixels: 1 } })); expect(L.identResultLine(inv.verdict(), true, true)).toContain('（検査は無効）');
  });
  it('the display\'s ways counts: passes drawn with a way (by way), passes with no way and why, and the GPU errors of its own submits', () => {
    const t = L.newPathLines({ used: 120, notUsed: 8, byWay: { B: 100, D: 20 }, reasons: { prep: 6, nodata: 2 }, errors: 1, notes: ['the display\'s resources made again after a GPU error (1)'] }).join('\n');
    expect(t).toContain('display ways: drew 120 passes with a way (B 100, D 20), no way for 8 passes (prep 6, nodata 2) · GPU errors of its own submits 1'); expect(t).toContain('made again after a GPU error'); expect(L.newPathLines(null)).toEqual([]);
  });
});

describe('the button, the guards and the loop of vr-view.js', () => {
  it('setSegModeFromMenu is the tab\'s button action as it was: the same signals in the same order and the same mode, for every old / new mode pair, with the menu\'s captured mode', () => {
    const src = /const setSegModeFromMenu=[^\n]*/.exec(vrView)[0], mk = new Function('emit', 'segMode', src + '\nreturn setSegModeFromMenu;');
    const oldBtn = (emit, segMode, key, j, m) => () => { emit('seg-toggle'); if (j === 2 && m !== 2) emit('seg-hide'); else if (j !== 2 && m === 2) emit('seg-show'); segMode[key] = j; }; // the closure of (vr-view.js, the 表示 tab)
    for (const m of [0, 1, 2]) for (const j of [0, 1, 2]) for (const cur of [0, 1, 2, undefined]) {
      const a = [], b = [], sa = { bone: cur }, sb = { bone: cur };
      mk(s => a.push(s), sa)('bone', j, m); oldBtn(s => b.push(s), sb, 'bone', j, m)();
      expect(a).toEqual(b); expect(sa).toEqual(sb);
    }
    const a = [], sm = { bone: 2 }; mk(s => a.push(s), sm)('bone', 0); expect(a).toEqual(['seg-toggle', 'seg-show']); expect(sm.bone).toBe(0); // the check's call: the current mode
    expect(vrView).toContain("btn(250+j*160,y,150,t,m===j,()=>setSegModeFromMenu(key,j,m),");
    expect(vrView).not.toContain("()=>{emit('seg-toggle');if(j===2&&m!==2)emit('seg-hide')");
  });
  it('the button sits right of 「自己診断を始める」 (x 620, y MENU_H-200, width 364, size 26), is grey while another recording / bench runs, without WebGPU, without a body, in the tutorial, and while it runs; its texts are the plan\'s', () => {
    expect(vrView).toContain("btn(620,MENU_H-200,364,txt,!!run?.active,");
    for (const t of ['同じ絵の検査（約5分）', 'Same-picture check (5 min)', '準備中', 'Preparing', "'検査中 残り'+left+'秒'", "'Checking '+left+' s left'", '検査済み', "'Checked'", '体を手で持って動かしてください 残り', 'Hold the body and move it, ', 'ほかの記録・ベンチが終わってから押してください', 'Press after the other recording or bench ends', '同じ絵の検査 実行中 ', 'Same-picture check running ']) expect(vrView, t).toContain(t);
    expect(vrView).toContain("grey=!gx?.vol||!mesh||!material||bench.active||anBench.active||cmpBench.active||selfCheck.active||gxRec.phase!=='idle'||gxRec.on||(tutLive&&!tutEnded)");
    expect(vrView).toContain("if(ui.identLine)label(X,MENU_H-250,ui.identLine"); // above the buttons; not the 詳細 tab's cmpLine
    expect(vrView).not.toMatch(/ui\.cmpLine=\(ident/);
  });
  it('the other recordings and benchmarks refuse while the check runs, and the check\'s run refuses while they run', () => {
    for (const needle of ["const startAnBench=()=>{if(anBench.active||bench.active||cmpBench.active||identRun?.active", "if(bench.active||cmpBench.active||identRun?.active||!mesh||gxRec.phase==='prep'||gxRec.on)return;\n  endAllDrags(); // ", "if(bench.active||anBench.active||selfCheck.active||identRun?.active||gxRec.phase!=='idle'||gxRec.on)return ja?'ほかのベンチ・記録が動いています'", "||cmpBench.active||identRun?.active||!mesh||!material)return; // not together with the benchmarks", "cmpBench.active||identRun?.active?(ja?'ベンチ実行中です'"]) expect(vrView, needle).toContain(needle);
    expect(vrView).toContain("if(bench.active||anBench.active||cmpBench.active||selfCheck.active||identRun?.active||gxRec.phase!=='idle'||gxRec.on)return ja?'ほかの記録・ベンチが終わってから押してください'");
  });
  it('the loop: the check\'s script ticks with the bench\'s, the frame count follows the draw, every frame is timed while it runs, the state of the frame goes with the draw call, the end of the session aborts it, and the check does not set the recording\'s or the bench\'s flags', () => {
    expect(vrView).toContain('if(identRun?.active)identRun.tick(performance.now());'); expect(vrView).toContain('if(identRun?.active)identRun.frame();');
    expect(vrView).toContain('setTimerEvery?.(gxMeasure()||identRun?.active?1:TS_SAMPLE_EVERY)'); expect(vrView).toContain('identCtx:identRun?.active?identCtxNow():null');
    expect(vrView).toContain("session.addEventListener('end',()=>{try{identRun.abort()}catch{}try{gx?.vol?.volume.ident.end()}catch{}},{once:true});");
    const gxMeasure = /const gxMeasure=\(\)=>[^\n]*/.exec(vrView)[0]; expect(gxMeasure).not.toContain('ident');
    expect(vrView).toContain("hCond={enabled:!!settings.moveLow,webgpu:!!gx,live:running?.session===session,recording:gxRec.phase==='prep'||gxRec.on,bench:benchOn||cmpBench.active}"); // the hold simplification stays allowed during the check (the hold part)
    expect(vrView).toContain("perfLog.sections.push(()=>identLog?identReportLines(identLog,");
  });
  it('the display\'s switches are not read by the check, the page makes no switch row (the constants are changed in code), and the texts of help / settings / i18n are untouched by this change', () => {
    expect(vrView).not.toMatch(/DIST_SPLIT_DISPLAY_DEFAULT|COARSE_PROXY_DISPLAY_DEFAULT|NEW_PATH_ALLOW_C4/);
    expect(read('vr-wgpu-ident.js')).not.toMatch(/DISPLAY_DEFAULT/);
  });
});

// ---- the review's fixes: errors, numbers, no body, CPU bytes, the count after a switch, the hold scale, the control ----
describe('a comparison that failed, came back as another\'s, or has no body in it is not counted', () => {
  const runC = async (frames, dev, o = {}) => {
    const rec = mkR({}, false, dev), results = [], u = o.u || sceneUniforms(); await ready(rec.r, u);
    const ok = await rec.r.volume.ident.begin({ cls4: false, onResult: r => results.push(r) }); expect(ok.ok).toBe(true);
    for (let i = 0; i < frames; i++) { frameOf(rec.r, u, { identCtx: { phase: 'auto', seg: 'hold/fast', measured: true, switchSeq: 0, hands: 0 } }); rec.r.volume.markFrame(true); await settle(); }
    await settle(); return { rec, results, u };
  };
  it('the draw and the comparison are inside a validation scope and an out-of-memory scope: two pushes before the first pass, two pops after the submit, once per comparison', withGpu(async () => {
    const { rec, results } = await runC(6, { echo: {}, errorScopes: {} });
    const log = rec.log, pushes = log.map((l, i) => (l.startsWith('pushErrorScope') ? i : -1)).filter(i => i >= 0), pops = log.map((l, i) => (l === 'popErrorScope' ? i : -1)).filter(i => i >= 0);
    expect(pushes.length).toBe(pops.length); expect(pushes.length).toBe(2 * (results.length + 6)); // (the check's comparisons, and the display's own low pass of each of the 6 frames) expect(log[pushes[0]]).toBe('pushErrorScope validation'); expect(log[pushes[1]]).toBe('pushErrorScope out-of-memory');
    const firstSubmit = log.findIndex((l, i) => i > pushes[1] && l.startsWith('submit')); expect(firstSubmit).toBeGreaterThan(pushes[1]); expect(pops[0]).toBeGreaterThan(firstSubmit);
    expect(log.slice(pushes[1] + 1, firstSubmit).some(l => l.startsWith('beginRenderPass'))).toBe(true);
    for (const r of results) expect(r.error).toBe('');
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
  it('an error from the scopes is on the comparison\'s result (and nothing else changes)', withGpu(async () => {
    const { rec, results } = await runC(5, { echo: {}, errorScopes: { scopeError: () => true } });
    expect(results.length).toBeGreaterThan(3); for (const r of results) expect(r.error).toContain('injected GPU error');
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
  it('each comparison carries its own number to the shader (params.w) and it must come back in the counters: numbers rise by one; a counter set that is not its own is an error', withGpu(async () => {
    const ok = await runC(8, { echo: {}, errorScopes: {} });
    expect(ok.results.map(r => r.nonce)).toEqual([...Array(ok.results.length).keys()].map(i => i + 1)); for (const r of ok.results) { expect(r.diff.nonce).toBe(r.nonce); expect(r.error).toBe(''); }
    ok.rec.r.volume.ident.end(); ok.rec.r.dispose();
    const bad = await runC(5, { echo: { badNonce: true }, errorScopes: {} });
    expect(bad.results.length).toBeGreaterThan(3); for (const r of bad.results) expect(r.error).toContain('not this comparison');
    bad.rec.r.volume.ident.end(); bad.rec.r.dispose();
    const t = identDiffWgsl(); expect(t).toContain('if(g.x==0u&&g.y==0u){atomicStore(&cnt[' + IDENT_DIFF.nonce + '],P.w);}'); expect(t).toContain('if(ca.a!=0.0){atomicAdd(&cnt[' + IDENT_DIFF.body + '],1u);}'); expect(IDENT_DIFF.total).toBe(IDENT_DIFF.nonce + 1);
    expect(read('vr-wgpu-ident.js')).toContain('new Uint32Array([cw, ch, split, nonce])');
  }));
  it('the ring\'s bind group follows the textures themselves: when the display\'s low target is another object (a bigger eye), a new group is made; no texture id is used as the key', withGpu(async () => {
    const rec = mkR({}, false, { echo: {}, errorScopes: {} }), u = sceneUniforms(); await ready(rec.r, u);
    await rec.r.volume.ident.begin({ cls4: false });
    const groups = () => rec.log.filter(l => /^createBindGroup .* 0=view\(tex#\d+\),1=view\(tex#\d+\),2=view\(tex#\d+\),3=view\(tex#\d+\),4=buf#\d+,5=buf#\d+$/.test(l)).length;
    const cx = { identCtx: { phase: 'auto', seg: 'a', measured: true } };
    for (let i = 0; i < 6; i++) { frameOf(rec.r, u, cx); await settle(); }
    const n = groups(); expect(n).toBeGreaterThan(0); expect(n).toBeLessThanOrEqual(4);
    for (let i = 0; i < 6; i++) { frameOf(rec.r, u, cx); await settle(); } expect(groups()).toBe(n); // the same textures: the groups stay
    const big = () => rec.r.draw({ u, cams: [eyeCam(2000, 2000), eyeCam(2000, 2000)], model: new THREEG.Matrix4(), f: 1, fov: false, fp: 1, rects: null, band: 1, variant: { cls4: false, events: false }, identCtx: cx.identCtx.constructor === Object ? cx.identCtx : null });
    for (let i = 0; i < 6; i++) { big(); await settle(); } expect(groups()).toBeGreaterThan(n);
    expect(read('vr-wgpu-ident.js')).not.toContain('__id'); expect(read('vr-wgpu-ident.js')).toContain('slot.keyObjs.some((x, i) => x !== keyObjs[i])');
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
  it('the positive control is the display\'s program without the shading maths (abl shade), whatever settings.refine is and whatever tissues are shown: it is made, used and compared with refine 0 as with refine 1', withGpu(async () => {
    const u = sceneUniforms(); u.refine.value = 0;
    const { rec, results } = await runC(24, { echo: {}, errorScopes: {} }, { u });
    const pos = results.filter(r => r.mode === 'pos'); expect(pos.length).toBeGreaterThanOrEqual(1); for (const r of pos) { expect(r.used).toBe(true); expect(r.unavailable).toBe(false); }
    expect(rec.stats.shaders.some(c => /abl=shade/.test(c))).toBe(true); expect(rec.stats.shaders.some(c => /abl=refine/.test(c) && /counters=false/.test(c))).toBe(false);
    expect(wgpu).toContain("abl: 'shade' }), setIdentOn");
    rec.r.volume.ident.end(); rec.r.dispose();
  }));
});

describe('the record: errors, bodies, the switch window, the render scale', () => {
  let n = 1000;
  const R = (mode, o = {}) => ({ mode, used: true, why: '', frame: n++, error: '', diff: { pixels: 0, body: 5000, maxColor: 0, maxDepth: 0, colorPixels: 0, rect: null, eyes: [0, 0], cells: new Array(16).fill(0), list: [] }, compared: 1, ms: { vol: 1, pre: 0, build: null }, disp: { vol: 1, pre: 0 }, sinceRebuild: 5, ctx: { phase: 'auto', seg: 'hold/fast', measured: true, switchSeq: 0, hands: 0, f: 0.7, t: 1000 }, ...o });
  it('a comparison with an error is not counted anywhere (not used, not a difference, not in a segment), is listed, and a way with even one is "not judged" however many clean ones there are; the controls\' errors are listed too', () => {
    const log = L.createIdentLog();
    for (let i = 0; i < 700; i++) for (const sg of L.IDENT_SEGMENTS) log.add(R('dist', { ctx: { ...R('dist').ctx, seg: sg.id } }));
    for (let i = 0; i < 200; i++) log.add(R('dist', { ctx: { ...R('dist').ctx, hands: 1 } })), log.add(R('dist', { ctx: { ...R('dist').ctx, seg: 'near/fast', switchSeq: 1 } }));
    for (let i = 0; i < 20; i++) log.add(R('same')), log.add(R('pos', { diff: { ...R('pos').diff, pixels: 9 } }));
    expect(log.verdict().ways.dist.state).toBe('none');
    log.add(R('dist', { error: 'injected GPU error', diff: { pixels: 77, body: 5000, maxColor: 9, maxDepth: 9, colorPixels: 1, rect: null, eyes: [1, 0], cells: [], list: [] } }));
    const t = log.T.dist, before = t.used; expect(t.err).toBe(1); expect(t.diff).toBe(0); expect(t.used).toBe(before);
    const v = log.verdict(); expect(v.ways.dist.state).toBe('notjudged'); expect(v.ways.dist.err).toBe(1); expect(v.ways.coarse.state).toBe('notjudged');
    log.add(R('same', { error: 'x' })); log.add(R('pos', { error: 'y' }));
    const text = L.identReportLines(log).join('\n'); expect(text).toContain('GPU ERRORS in 1 comparisons'); expect(text).toContain('injected GPU error'); expect(text).toContain('control same: 1 with a GPU error'); expect(text).toContain('control pos: 1 with a GPU error');
    expect(log.rows.some(r => r.why === 'error')).toBe(true); expect(L.identResultLine(v, true, true)).toContain('distSplit 0/');
  });
  it('a comparison whose display picture has no body (fewer than bodyPx pixels with alpha) is not counted, the positive control included; the run is not made invalid by it', () => {
    const log = L.createIdentLog(), none = { ...R('dist').diff, body: 0 }, few = { ...R('dist').diff, body: L.IDENT_MIN.bodyPx - 1 }, edge = { ...R('dist').diff, body: L.IDENT_MIN.bodyPx };
    log.add(R('dist', { diff: none })); log.add(R('dist', { diff: few })); log.add(R('dist', { diff: edge }));
    expect(log.T.dist.noBody).toBe(2); expect(log.T.dist.used).toBe(1); expect(log.T.dist.diff).toBe(0);
    log.add(R('same', { diff: { ...R('same').diff, pixels: 5, body: 0 } })); log.add(R('pos', { diff: { ...R('pos').diff, pixels: 0, body: 0 } })); // a control that differs / does not differ in a picture with no body: no evidence either way
    expect(log.T.same.diff).toBe(0); expect(log.T.same.noBody).toBe(1); expect(log.T.pos.noBody).toBe(1); expect(log.T.pos.used).toBe(0);
    for (let i = 0; i < 5; i++) log.add(R('pos', { diff: { ...R('pos').diff, pixels: 3 } })); log.add(R('same'));
    expect(log.verdict().valid).toBe(true); // the controls that counted are right: the invisible body voided nothing
    const text = L.identReportLines(log).join('\n'); expect(text).toContain('no body in the picture: 2 (not counted)'); expect(log.rows.filter(r => r.why === 'nobody').length).toBe(4);
  });
  it('a segment in which the body is out of sight stays short of the count and is "not judged", the other segments are judged on their own numbers', () => {
    const log = L.createIdentLog();
    for (const w of L.IDENT_WAYS) for (const sg of L.IDENT_SEGMENTS) for (let i = 0; i < 150; i++) log.add(R(w, { diff: { ...R(w).diff, body: sg.id === 'far/slow' ? 0 : 5000 }, ctx: { ...R(w).ctx, seg: sg.id } }));
    for (const w of L.IDENT_WAYS) for (let i = 0; i < 150; i++) log.add(R(w, { ctx: { ...R(w).ctx, hands: 1 } })), log.add(R(w, { ctx: { ...R(w).ctx, switchSeq: 1, seg: 'near/fast' } }));
    for (let i = 0; i < 20; i++) log.add(R('same')), log.add(R('pos', { diff: { ...R('pos').diff, pixels: 4 } }));
    const v = log.verdict(); expect(v.valid).toBe(true); expect(v.ways.dist.seg[4]).toBe(0); expect(v.ways.dist.state).toBe('notjudged'); expect(v.ways.dist.seg[0]).toBe(150);
  });
  it('after a tissue switch every way counts from the comparison that used it again: the frames in between (drawn the old way) are kept by reason, only used comparisons within 30 of the volume\'s frames after the first count, the window starts again at the next switch', () => {
    const log = L.createIdentLog(), sw = k => ({ ctx: { ...R('x').ctx, switchSeq: k } });
    // dist: the switch at frame 2000, rebuild frames 2000..2039 drawn the old way (reasons), used again from 2040, one used comparison a frame to 2099
    for (let f = 1990; f < 2000; f++) log.add(R('dist', { frame: f }));
    for (let f = 2000; f < 2040; f++) log.add(R('dist', { frame: f, used: false, why: f < 2030 ? 'nodata' : 'rebuild', ...sw(1) }));
    for (let f = 2040; f < 2100; f++) log.add(R('dist', { frame: f, ...sw(1) }));
    expect(log.T.dist.afterNot).toEqual({ nodata: 30, rebuild: 10 }); expect(log.T.dist.sw).toBe(31); // frames 2040..2070 (age 0..30)
    expect(log.rows.find(r => r.mode === 'dist' && r.age === 0).age).toBe(0); expect(log.rows.filter(r => r.age === 31).length).toBe(1);
    for (let f = 3000; f < 3050; f++) log.add(R('dist', { frame: f, ...sw(2) })); // the next switch: usable at once
    expect(log.T.dist.sw).toBe(31 + 31); expect(log.T.dist.afterNot).toEqual({ nodata: 30, rebuild: 10 });
    // another way is judged by its own frames: coarse is back 20 frames later than dist
    for (let f = 4000; f < 4020; f++) log.add(R('coarse', { frame: f, used: false, why: 'rebuild', ...sw(1) }));
    for (let f = 4020; f < 4060; f++) log.add(R('coarse', { frame: f, ...sw(1) }));
    expect(log.T.coarse.sw).toBe(31); expect(log.T.coarse.afterNot).toEqual({ rebuild: 20 });
    const text = L.identReportLines(log).join('\n'); expect(text).toContain('drawn the old way between a tissue switch and the way being usable again: nodata 30, rebuild 10'); expect(text).toContain('frames after the way was usable again following');
  });
  it('the counts by render scale f: comparisons that used a way, per f (2 decimals) and per way', () => {
    const log = L.createIdentLog();
    for (let i = 0; i < 3; i++) log.add(R('dist', { ctx: { ...R('dist').ctx, f: 0.7234 } })); for (let i = 0; i < 2; i++) log.add(R('coarse', { ctx: { ...R('coarse').ctx, f: 0.7234 } })); log.add(R('dist', { ctx: { ...R('dist').ctx, f: 0.5 } })); log.add(R('dist', { used: false, why: 'c4', ctx: { ...R('dist').ctx, f: 0.3 } }));
    expect([...log.byF.keys()].sort()).toEqual([0.5, 0.72]); expect(log.byF.get(0.72)).toEqual({ dist: 3, coarse: 2 });
    expect(L.identReportLines(log).join('\n')).toContain('by render scale f (2 decimals): 0.5: 0/1/0/0 · 0.72: 0/3/2/0  (same/dist/coarse/both)');
  });
});

describe('the sixth segment (the hold scale), the tissue switch numbers and the guards of the page', () => {
  it('the run asks for the hold only in the sixth segment, counts every switch (hide and show) and says so in its state', () => {
    const log = [], tissues = { bone: 0 }, st = { t: 0 };
    const env = { now: () => st.t, can: () => '', enter() {}, leave() {}, done() {}, ready: () => true, ref: () => ({ x: 0, y: 1.6, z: 0, yaw: 0 }), pose() {}, segState: () => ({ ...tissues }), setSegMode: (k, j) => { tissues[k] = j; }, shownKey: () => 'bone', cue() {}, progress() {}, holdStart() {} };
    const run = L.createIdentRun(env, { budgetMs: 1000 / 72 }); run.start(); const seen = [];
    while (run.phase !== 'hold' && run.phase !== 'done') { st.t += 1000 / 72 * 4; run.tick(st.t); run.frame(); seen.push([run.state.seg, run.state.simHold, run.state.switchSeq]); }
    expect([...new Set(seen.filter(x => x[1]).map(x => x[0]))]).toEqual(['hold/fast-held']); expect(seen.filter(x => !x[1]).length).toBeGreaterThan(seen.filter(x => x[1]).length);
    expect(seen[seen.length - 1][2]).toBe(4); expect(seen.find(x => x[0] === 'near/fast' && x[2] === 1)).toBeTruthy(); expect(run.state.simHold).toBe(false); log.push(1);
  });
  it('the page counts one more hand as holding while the check asks for it, so the hold gate and the hold scale run as for a real hold; the context carries the switch number and the flag', () => {
    expect(vrView).toContain("grabbing.has(c)&&c.userData.source?1:0),0)+(identRun?.active&&identRun.state.simHold?1:0),hCond=");
    expect(vrView).toContain('switchSeq:identSeqApplied,simHold:!!s.simHold'); // the number the frame's uniforms carry (see the describe below), not the run's own
    expect(vrView).toContain("holdOn=holdGate.step(heldTracked>0,nowG,{allowed:holdAllowed(hCond)}),holdK=holdScaleOf({...hCond,heldTracked:holdOn?1:0,scale:settings.moveLowK})");
  });
  it('no data switch (a practice / tutorial data starts from one) while the check runs: swapData is wrapped, the swap\'s own text is untouched', () => {
    expect(vrView).toContain("{ const swapData0=swapData; swapData=async setId=>{if(identRun?.active){flashMsg(ja?'ほかの記録・ベンチが終わってから押してください'");
    expect(vrView).toContain("return false}return swapData0(setId)} }"); expect(vrView).toContain('if(!running||ui.swapBusy)return false;\n   stopPair();');
  });
  it('the combined texture is marked while its rebuild goes up (docs/vr-combo-rebuild.js writes the alpha into the bytes ahead of the slab), every frame, before the draw', () => {
    const i = vrView.indexOf('gx.vol.volume.markCpuBusy?.(material.uniforms.clsTex?.value,!!comboT?.rb?.busy);'); expect(i).toBeGreaterThan(0); expect(vrView.indexOf('gx.vol.draw({u:(diagAn.noRegion?null:partGxU(vk))||material.uniforms,cams,')).toBeGreaterThan(i);
  });
  it('a destroyed instance no longer follows the combined texture\'s writes', withGpu(async () => {
    const rec = mkR({}, false, { echo: {}, errorScopes: {} }), u = sceneUniforms(); await ready(rec.r, u);
    expect(rec.r.volume.newPath.writers()).toBe(1); // the display's own
    await rec.r.volume.ident.begin({ cls4: false }); expect(rec.r.volume.newPath.writers()).toBe(2);
    rec.r.volume.ident.end(); expect(rec.r.volume.newPath.writers()).toBe(1);
    rec.r.dispose();
    const d = mkR(), u2 = sceneUniforms(); await ready(d.r, u2); frameOf(d.r, u2); expect(d.r.volume.newPath.writers()).toBe(1); d.r.dispose(); expect(d.r.volume.newPath.writers()).toBe(0);
  }));
});

describe('the distance texture is made on the GPU from the GPU\'s own bytes: the CPU\'s copy of the combined texture does not matter', () => {
  it('while the combined texture\'s rebuild is going up (markCpuBusy) the display keeps drawing B: no frame is the old way and nothing is built from the CPU bytes', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 4; i++) frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' });
    rec.r.volume.markCpuBusy(u.clsTex.value, true);
    for (let i = 0; i < 3; i++) { frameOf(rec.r, u); expect(rec.r.stats.np).toMatchObject({ use: true, way: 'B' }); }
    expect(rec.r.volume.newPath.stats().reasons.nodata ?? 0).toBe(0);
    rec.r.volume.markCpuBusy(u.clsTex.value, false);
    rec.r.dispose();
  }));
  it('bytes that are not the texture\'s own array going up through copySlab (a bake) do not stop the new way: the distance texture is made again from the GPU\'s bytes, in the same frame', withGpu(async () => {
    const rec = mkR({ distSplitDisplay: true, coarseDisplay: true }), u = sceneUniforms(); await ready(rec.r, u);
    for (let i = 0; i < 4; i++) frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true);
    const t = u.clsTex.value, other = new THREEG.Data3DTexture(new Uint8Array(16 ** 3 * 4), 16, 16, 16); other.format = THREEG.RGBAFormat; other.type = THREEG.UnsignedByteType;
    const n0 = rec.log.length; rec.r.volume.copySlab(other, t, { min: { z: 0 }, max: { z: 2 } });
    expect(rec.log.slice(n0).some(l => l.startsWith('copyBufferToTexture'))).toBe(true); // the write is followed by the distance texture's own copy of the same slices
    for (let i = 0; i < 3; i++) { frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true); }
    rec.r.dispose();
  }));
  it('the session start (preload) makes the distance texture whole (compute passes and copies in 64-slice chunks), the first frame finds it and makes nothing, and a write of slices [z0, z1) is followed by a copy of those slices only', withGpu(async () => {
    const rec = mkR(), u = sceneUniforms(32); const n00 = rec.log.length; await ready(rec.r, u);
    const cp0 = rec.log.slice(n00).filter(l => l.startsWith('copyBufferToTexture')); expect(cp0).toHaveLength(1); expect(cp0[0]).toMatch(/ 32,32,32 z0$/);
    const n0 = rec.log.length; frameOf(rec.r, u); expect(rec.r.stats.np.use).toBe(true); expect(rec.log.slice(n0).filter(l => l.startsWith('copyBufferToTexture'))).toEqual([]);
    const t = u.clsTex.value; const n1 = rec.log.length; rec.r.volume.copySlab(t, t, { min: { z: 10 }, max: { z: 12 } });
    expect(rec.log.slice(n1).filter(l => l.startsWith('copyBufferToTexture'))).toEqual([expect.stringMatching(/ 32,32,2 z10$/)]);
    rec.r.dispose();
  }));
  it('8-2: a program that no other way can stand in for (the distance texture\'s) that does not compile is asked for once more, and if it fails again the session start (preload) fails with the reason; the ways of B and OS have a fallback and do not fail the start', withGpu(async () => {
    const rec = mkR(), u = sceneUniforms(32), orig = rec.device.createComputePipelineAsync; let calls = 0;
    rec.device.createComputePipelineAsync = async d => { if (/distance bytes of the combined texture/.test(d.compute.module.code)) { calls++; throw new Error('nope'); } return orig(d); };
    await expect(rec.r.preload(u, [{ cls4: false, events: false }])).rejects.toThrow(/did not compile.*nope/); expect(calls).toBe(2);
    rec.r.dispose();
    const ok = mkR(), orig2 = ok.device.createRenderPipelineAsync; ok.device.createRenderPipelineAsync = async d => { if (/coarse-tile=4/.test(d.vertex.module.code)) throw new Error('boom'); return orig2(d); };
    await ok.r.preload(u, [{ cls4: false, events: false }]); frameOf(ok.r, u); expect(ok.r.stats.np).toMatchObject({ use: true, way: 'D' }); ok.r.dispose();
  }));
});

// ---- the second review: the frame that moves the switch, errors outside the measured time, the shrink actually applied ----
describe('the tissue-switch number goes with the picture it belongs to; errors outside the measured time and the shrink are said', () => {
  // the page's frame order (docs/vr-view.js): the combined texture's tick, THEN segA / segC are written (the picture of the frame) and the number the picture carries is decided from them, THEN identRun.tick moves the mode and its own number, then the frame is drawn and compared.
  // The model of the picture: a hide shows in segA.w at the next frame; a show only 40 frames after the tick (the alpha goes up over those frames; the tissue is inside safeMask, so inside comboShaderMask, only at the end).
  // `rule`: 'picture' = the page's (the number moves at the frame whose shown flags differ from the frame before), 'tick' = the earlier one (identSeqApplied taken before the tick, so the number moves one frame after the tick), 'run' = the run's own number after the tick (the very first one)
  const sigOf = w => w.reduce((a, x) => a * 3 + (x > 0.5 ? 1 : 0), 0); // the page's formula with every shown slot's simple flag 0
  const simulate = ({ rule }) => {
    const tissues = { bone: 0 }, st = { t: 0 };
    const env = { now: () => st.t, can: () => '', enter() {}, leave() {}, done() {}, ready: () => true, ref: () => ({ x: 0, y: 1.6, z: 0, yaw: 0 }), pose() {}, segState: () => ({ ...tissues }), setSegMode: (k, j) => { tissues[k] = j; }, shownKey: () => 'bone', cue() {}, progress() {}, holdStart() {} };
    const run = L.createIdentRun(env, { budgetMs: 1000 / 72 }), log = L.createIdentLog({ min: { ...L.IDENT_MIN, rows: 100000 } }); run.start();
    let frame = 1000, applied = 0, sigPrev = -1, rb = 0, hideF = null, showF = null, pictureF = null, after = 0; const seqAt = new Map();
    const body = { pixels: 0, body: 5000, maxColor: 0, maxDepth: 0, colorPixels: 0, rect: null, eyes: [0, 0], cells: [], list: [] };
    for (; ;) {
      st.t += 1000 / 72; frame++;
      if (rb > 0) rb--;
      const segW = tissues.bone !== 2 && rb === 0 ? 1 : 0; // segA.w of the slot, as written at this frame
      if (rule === 'tick') applied = run.state.switchSeq;
      else if (rule === 'picture') { const sg = sigOf([segW]); if (sg !== sigPrev) { sigPrev = sg; applied = run.state.switchSeq; if (showF !== null && pictureF === null) pictureF = frame; } }
      const before = tissues.bone; run.tick(st.t);
      if (hideF === null && run.state.switchSeq === 1) hideF = frame;
      if (showF === null && run.state.switchSeq === 2) showF = frame;
      if (before === 2 && tissues.bone !== 2) rb = 40; // the show is asked for at this tick; the rebuild starts at the next frame
      const seq = rule === 'run' ? run.state.switchSeq : applied; seqAt.set(frame, seq);
      // dist is always usable; both is stopped for the frames of the rebuild (markCpuBusy: the bytes are not the GPU's), coarse is not
      const usedBoth = rb === 0;
      for (const [mode, used] of [['dist', true], ['coarse', true], ['both', usedBoth]]) log.add({ mode, used, why: used ? '' : 'nodata', frame, error: '', diff: body, compared: 1, ms: { vol: 1, pre: 0, build: null }, disp: { vol: 1, pre: 0 }, sinceRebuild: 5,
        ctx: { phase: run.state.phase, seg: run.state.seg, measured: !!run.state.measured, switchSeq: seq, hands: 0, f: 1, t: st.t } });
      run.frame();
      if (showF !== null && (pictureF !== null || rule !== 'picture') && ++after >= 100) break;
    }
    return { log, seqAt, hideF, showF, pictureF };
  };
  it('a hide moves the number at the next frame (the picture changes then), a show only at the frame the tissue is drawn again (the alpha is up): the frames of the rebuild keep the old number, for every way', () => {
    const { log, seqAt, hideF, showF, pictureF } = simulate({ rule: 'picture' });
    expect(seqAt.get(hideF)).toBe(0); expect(seqAt.get(hideF + 1)).toBe(1); // the frame that moved the tissue still draws the picture before the switch: the old number
    expect(pictureF).toBe(showF + 40);
    for (let f = showF; f < pictureF; f++) expect(seqAt.get(f)).toBe(1); // the show's tick frame and the 39 frames of the rebuild: the old number (the picture is still without the tissue)
    expect(seqAt.get(pictureF)).toBe(2); expect(seqAt.get(pictureF + 5)).toBe(2);
    // coarse (not stopped during the rebuild) used those frames and they are not the show's: no window of its own was opened by them; the window starts at the frame the picture is there
    expect(log.T.coarse.afterNot).toEqual({}); expect(log.T.coarse.sw).toBe(62); expect(log.T.dist.sw).toBe(62); // 31 after the hide + 31 after the show, each from age 0
  });
  it('the first comparison after the alpha is up opens the show\'s window at age 0 (a way that was stopped meanwhile resumes there, the frames it was stopped in are not the show\'s); with the earlier rules the number came 40 frames before the picture', () => {
    const a = simulate({ rule: 'picture' });
    expect(a.log.T.both.sw).toBe(62); expect(a.log.T.both.afterNot).toEqual({}); // the stopped frames carry the old number: no waiting is opened by them
    const ages = a.log.rows.filter(r => r.mode === 'both' && r.age === 0); expect(ages.length).toBe(2); // the hide's and the show's resume
    const b = simulate({ rule: 'tick' }); // the previous rule: the number moves one frame after the tick, 40 frames before the picture
    expect(b.seqAt.get(b.showF + 1)).toBe(2); expect(a.seqAt.get(a.showF + 1)).toBe(1); // the new number came at the first frame of the rebuild (a picture without the tissue): the way used then (coarse) opened its window on that picture, 40 frames before the real one
    const c = simulate({ rule: 'run' }); // the first rule: the run's own number, taken after the tick
    expect(c.seqAt.get(c.showF)).toBe(2);
  });
  it('the page: the number is decided from segA / segC after they are written (the end of that block) and before identRun.tick; the held scale factor of the frame is kept for the check\'s context; nothing else of the frame moves (plain variables, no GPU call)', () => {
    const iSet = vrView.indexOf('if(identRun?.active){let sg=0;for(let i=0;i<4;i++)sg=sg*3+(u.segA.value[i].w>0.5?1+(u.segC.value[i].w>0.5?1:0):0);if(sg!==identSeqSig){identSeqSig=sg;identSeqApplied=identRun.state.switchSeq}}else identSeqSig=-1;'), iSeg = vrView.indexOf('u.segA.value[i].set(seg?.min||0'), iSegC = vrView.indexOf('u.segC.value[i].set(color.r,color.g,color.b'), iPart = vrView.indexOf('partFrame(); // an earlier change'), iTick = vrView.indexOf('if(identRun?.active)identRun.tick(performance.now());'), iDraw = vrView.indexOf('identCtx:identRun?.active?identCtxNow():null'), iHk = vrView.indexOf('identHoldKA=holdKA;');
    expect(iSeg).toBeGreaterThan(0); expect(iSet).toBeGreaterThan(iSeg); expect(iSet).toBeGreaterThan(iSegC); expect(iSet).toBeGreaterThan(iPart); expect(iTick).toBeGreaterThan(iSet); expect(iHk).toBeGreaterThan(iTick); expect(iDraw).toBeGreaterThan(iHk);
    expect(vrView.split('identSeqApplied').length - 1).toBe(3); // declared, set, read in identCtxNow: nowhere else
    expect(vrView.split('identHoldKA').length - 1).toBe(3); // declared, set before the draw, read in identCtxNow
    expect(vrView).toContain('let identRun=null,identSeqApplied=0,identSeqSig=-1,identHoldKA=1,identLog=null,');
    expect(vrView).toContain('switchSeq:identSeqApplied,simHold:!!s.simHold'); expect(vrView).toContain('f:rs.eff,hk:identHoldKA,');
    expect(vrView).toContain('if(identRun?.active)identRun.tick(performance.now());'); // identRun.tick stays where it was
  });
  it('errors in comparisons outside the measured time (the first 2 s of a segment, the preparation, the idle part of the hold part) are counted and said in one line, whatever their way, and change no count and no verdict', () => {
    const base = { used: true, why: '', frame: 1, error: '', diff: { pixels: 0, body: 5000, maxColor: 0, maxDepth: 0, colorPixels: 0, rect: null, eyes: [0, 0], cells: [], list: [] }, compared: 1, ms: { vol: 1, pre: 0, build: null }, disp: { vol: 1, pre: 0 }, sinceRebuild: 5 };
    const cx = m => ({ phase: 'auto', seg: 'hold/fast', measured: m, switchSeq: 0, hands: 0, f: 1, t: 1 });
    const log = L.createIdentLog(), ref = L.createIdentLog();
    for (const l of [log, ref]) for (let i = 0; i < 5; i++) { l.add({ ...base, mode: 'dist', ctx: cx(true) }); l.add({ ...base, mode: 'same', ctx: cx(true) }); }
    expect(log.unmeasuredErr).toBe(0); expect(L.identReportLines(log).join('\n')).toContain('not in any count above): 0');
    expect(log.add({ ...base, mode: 'dist', error: 'GPU error: oom', ctx: cx(false) })).toBe(false); // not counted as a comparison (as before)
    log.add({ ...base, mode: 'coarse', error: 'read-back is not this comparison\'s (number 7, expected 8)', ctx: cx(false) }); log.add({ ...base, mode: 'pos', error: 'no counters read back', ctx: { ...cx(false), phase: 'prep' } });
    log.add({ ...base, mode: 'dist', error: '', ctx: cx(false) }); // a clean one outside the measured time: nothing
    log.add({ ...base, mode: 'dist', error: 'x' }); // no context at all: not measured either
    expect(log.unmeasuredErr).toBe(4); expect(log.unmeasuredErrBy).toEqual({ dist: 2, coarse: 1, pos: 1 });
    expect(log.count).toBe(ref.count); expect(log.T.dist.err).toBe(0); expect(log.T.dist.n).toBe(ref.T.dist.n); expect(log.errors.length).toBe(0); expect(JSON.stringify(log.verdict())).toBe(JSON.stringify(ref.verdict()));
    const text = L.identReportLines(log).join('\n'); expect(text).toContain('errors in comparisons whose time is not measured'); expect(text).toContain('not in any count above): 4 (dist 2, coarse 1, pos 1)');
  });
  it('the hold scale: comparisons that used a way with holdKA < 1 are counted per way, in the held part and in the sixth segment, and said in one line with the render scale f < 1 beside it; the verdict is the same as without the counts', () => {
    const base = { used: true, why: '', frame: 1, error: '', diff: { pixels: 0, body: 5000, maxColor: 0, maxDepth: 0, colorPixels: 0, rect: null, eyes: [0, 0], cells: [], list: [] }, compared: 1, ms: { vol: 1, pre: 0, build: null }, disp: { vol: 1, pre: 0 }, sinceRebuild: 5 };
    const cx = (seg, f, hk, hands = 0) => ({ phase: 'auto', seg, measured: true, switchSeq: 0, hands, f, hk, t: 1 });
    const log = L.createIdentLog();
    for (let i = 0; i < 4; i++) log.add({ ...base, mode: 'dist', ctx: cx('hold/fast', 1, 1) }); // not shrunk
    for (let i = 0; i < 3; i++) log.add({ ...base, mode: 'dist', ctx: cx('hold/fast-held', 0.6, 0.6) }); // the sixth segment, the hold scale applied
    for (let i = 0; i < 2; i++) log.add({ ...base, mode: 'dist', ctx: cx('hold/fast', 0.6, 0.6, 1) }); // a hand holds, the hold scale applied
    log.add({ ...base, mode: 'dist', ctx: cx('hold/fast', 0.7, 1, 1) }); // a hand holds, f < 1 from the ladder but no hold scale
    log.add({ ...base, mode: 'dist', used: false, why: 'c4', ctx: cx('hold/fast', 0.5, 0.5) }); // did not use the way: not counted
    log.add({ ...base, mode: 'both', ctx: cx('near/slow', 0.9999999, 0.9999999) }); // 1 up to rounding: not shrunk
    log.add({ ...base, mode: 'coarse', ctx: { ...cx('near/slow', 0.5, 0.5), f: undefined, hk: undefined } }); // no numbers: not shrunk
    log.add({ ...base, mode: 'same', ctx: cx('near/slow', 0.7, 1) });
    const t = log.T.dist; expect(t.used).toBe(10); expect(t.hk).toBe(5); expect(t.hkHeld).toBe(2); expect(t.hkSeg).toEqual({ 'hold/fast-held': 3 }); expect(t.shrunk).toBe(6); expect(t.shrunkHeld).toBe(3); expect(t.shrunkSeg).toEqual({ 'hold/fast-held': 3 });
    expect(log.T.both.hk).toBe(0); expect(log.T.coarse.hk).toBe(0); expect(log.T.same.hk).toBe(0); expect(log.T.same.shrunk).toBe(1);
    const line = L.identReportLines(log).find(x => x.startsWith('comparisons that used a way with the hold scale applied (holdKA < 1)')); expect(line).toBeDefined();
    expect(line).toContain('dist holdKA<1 5/10 (held 2/3, hold/fast-held 3/3) f<1 6/10 (held 3/3, hold/fast-held 3/3)'); expect(line).toContain('same holdKA<1 0/1 (held 0/0, hold/fast-held 0/0) f<1 1/1'); expect(line).toContain('both holdKA<1 0/1');
    // none of the verdict's numbers moves with it
    const v = log.verdict(); expect(v.ways.dist.used).toBe(10); expect(v.ways.dist.held).toBe(3);
  });
});
