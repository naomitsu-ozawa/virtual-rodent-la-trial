// The measurement of the parts' own tiles (n764 plan 4-1, stage 0): the counting twin with the partOcc counts (docs/vr-wgsl-core.js counters: 'part'), the decoding and the lines of the performance record (docs/vr-part-probe-log.js),
// and the host's probe of a part (docs/vr-wgpu.js partProbe / partProbeCounters, a recording device: no GPU in CI). The display's texts and device calls are pinned elsewhere (wgsl-text-hash.test.js, vr-breakdown.test.js, the display-off calls).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, COUNTER_FIELDS, PART_COUNTER_FIELDS } from '../../docs/vr-wgsl-core.js';
import { decodePartWindow, createPartProbeLog, PP_STRIDE, ppLabel } from '../../docs/vr-part-probe-log.js';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import { GPU_GLOBALS, recordingDevice, sceneUniforms, eyeCam } from '../helpers/gpu-call-log.js';

const sha = t => createHash('sha256').update(t).digest('hex');
const withGpu = fn => async () => { for (const [k, v] of Object.entries(GPU_GLOBALS)) vi.stubGlobal(k, v); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));

describe('WGSL: the parts\' counting twin', () => {
  const PART_FEATS = [{ R: true, P: true }, { C: true, P: true }, { R: true, C: true, P: true }];
  it('the texts that were there before are those of, byte for byte: the display variants with and without the features, and the counting twin (counters: true) of each', () => {
    const want = JSON.parse(readFileSync(new URL('./fixtures/wgsl-text-hashes-counters.json', import.meta.url), 'utf8'));
    const feats = { none: null, RCP: { R: true, C: true, P: true }, RP: { R: true, P: true }, CP: { C: true, P: true } }, got = {};
    for (const [fn, feat] of Object.entries(feats)) for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const events of [false, true]) {
      const k = `${fn} f16=${f16} c4=${cls4} ev=${events}`;
      got['display ' + k] = sha(volumeWgsl({ f16, cls4, events, feat })); got['counters ' + k] = sha(volumeWgsl({ f16, cls4, events, feat, counters: true }));
    }
    expect(got).toEqual(want);
  });
  it('the record: COUNTER_FIELDS as before, then partSkips / partSkips0 / partSkipSteps (counters: true keeps its 18 and its write-out)', () => {
    expect(COUNTER_FIELDS).toHaveLength(18);
    expect(PART_COUNTER_FIELDS).toEqual([...COUNTER_FIELDS, 'partSkips', 'partSkips0', 'partSkipSteps']);
    for (const feat of PART_FEATS) for (const cls4 of [false, true]) for (const events of [false, true]) {
      const t = volumeWgsl({ cls4, events, feat, counters: 'part' }), c = volumeWgsl({ cls4, events, feat, counters: true });
      expect(() => new WgslReflect(t)).not.toThrow();
      expect(t).toContain('(u32(in.pos.y)*CNT_W+u32(in.pos.x))*21u'); expect(c).toContain('(u32(in.pos.y)*CNT_W+u32(in.pos.x))*18u');
      expect(t).toContain('cnt[b+17u]=gL16;cnt[b+18u]=gPS;cnt[b+19u]=gPS0;cnt[b+20u]=gPSS;\n return fo;');
      expect(t).toContain('var<private> gPS:u32=0u;var<private> gPS0:u32=0u;var<private> gPSS:u32=0u;');
      // the count is made where a ray leaves out an 8^3 block of the part's field, before the jump; a skip made while no march sample has been read counts as before the first read
      expect(t.split('gPS+=1u;gPSS+=u32(pm);if(gClsRd==0u){gPS0+=1u;}prevValid=true;prevSkip=false;lastIndex=-1;k+=pm;continue;').length - 1).toBe(1);
      expect(c).not.toContain('gPS'); expect(c).not.toContain('cnt[b+18u]');
    }
  });
  it('a text without the parts\' block has no place to count: the part twin throws (a part always has feat P)', () => {
    expect(() => volumeWgsl({ counters: 'part' })).toThrow(/anchor found 0 times/); expect(() => volumeWgsl({ feat: { R: true }, counters: 'part' })).toThrow(/anchor found 0 times/);
  });
  it('the header names the twin', () => { expect(volumeWgsl({ feat: { R: true, P: true }, counters: 'part' })).toMatch(/counters=part\n/); expect(volumeWgsl({ counters: true })).toMatch(/counters=true\n/); });
});

describe('the decoding of a probe window', () => {
  const win = (w, h, rays) => { const a = new Uint32Array(w * h * PP_STRIDE); for (const [x, y, rec] of rays) for (const [k, v] of Object.entries(rec)) a[(y * w + x) * PP_STRIDE + PART_COUNTER_FIELDS.indexOf(k)] = v; return a; };
  it('rays, misses, loops, skips and skip-only rays of one window; a pixel outside the pass (outcome 0) is nothing', () => {
    const c = win(16, 8, [
      [0, 0, { outcome: 2, iters: 3, partSkips: 3, partSkips0: 3, partSkipSteps: 30 }], // skip-only, began with a skip
      [1, 0, { outcome: 2, iters: 5, partSkips: 2, partSkips0: 1, partSkipSteps: 9, clsReads: 3 }], // skipped, then read
      [2, 0, { outcome: 1, iters: 10, clsReads: 10 }], // no skip at all
      [3, 0, { outcome: 4 }], // left before the march
      [4, 0, { outcome: 2, iters: 0 }], // marched, no iteration
    ]);
    const d = decodePartWindow(c, 16, 8);
    expect(d).toMatchObject({ px: 5, rays: 4, miss: 1, hits: 1, sumIters: 18, sumSkips: 5, sumSkips0: 4, sumSkipSteps: 39, sumClsReads: 13, raysWithSkips: 2, raysSkip0: 2, raysSkipOnly: 1, raysNoRead: 1, raysNoLoop: 1, skipOnlyIters: 3 });
    expect(d.loops.sort((a, b) => a - b)).toEqual([0, 3, 5, 10]);
  });
  it('tiles of 8 x 8 window pixels: skip-only (every ray with iterations skip-only), mixed, none, empty (no marched ray)', () => {
    const rays = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) rays.push([x, y, { outcome: 2, iters: 2, partSkips: 2 }]); // tile (0,0): all skip-only
    rays.push([8, 0, { outcome: 2, iters: 2, partSkips: 2 }], [9, 0, { outcome: 2, iters: 4, partSkips: 1, clsReads: 3 }]); // tile (1,0): mixed
    rays.push([0, 8, { outcome: 2, iters: 4, clsReads: 4 }]); // tile (0,1): none
    rays.push([8, 8, { outcome: 4 }]); // tile (1,1): only a miss: empty
    const d = decodePartWindow(win(16, 16, rays), 16, 16);
    expect(d.tiles).toEqual({ n: 4, skipOnly: 1, mixed: 1, none: 1, empty: 1, itersSkipOnly: 128 });
  });
  it('a buffer that is too short or an empty window is null', () => { expect(decodePartWindow(new Uint32Array(5), 4, 4)).toBe(null); expect(decodePartWindow(null, 4, 4)).toBe(null); });
});

describe('the lines of the performance record', () => {
  const part = { kind: 1, id: 7, way: 'part D0' };
  const one = (iters, skips, skips0, reads) => ({ outcome: 2, iters, partSkips: skips, partSkips0: skips0, partSkipSteps: skips * 10, clsReads: reads });
  const win = rays => { const a = new Uint32Array(64 * 64 * PP_STRIDE); rays.forEach(([x, y, rec]) => Object.entries(rec).forEach(([k, v]) => { a[(y * 64 + x) * PP_STRIDE + PART_COUNTER_FIELDS.indexOf(k)] = v; })); return a; };
  it('a recording with no round yet: the status line says so (nothing is silent); a part with its windows: the per-ray figures, and the tiles only for the native window; the part\'s way is named', () => {
    const log = createPartProbeLog(); expect(log.lines().filter(l => l.startsWith('status: '))).toEqual(['status: 0 probe rounds (0 with no part in the frame), most parts in a frame 0, windows decoded 0, probes that found the program still being made 0, probes skipped for a read not done 0']);
    log.round({ items: [], parts: 2, pending: 1, busy: 0 }); log.round({ items: [], parts: 0, pending: 0, busy: 2 });
    expect(log.add(part, 'whole', win([[0, 0, one(4, 4, 4, 0)], [1, 0, one(8, 2, 1, 5)]]), 64, 64)).toBe(true);
    expect(log.add(part, 'native', win([[0, 0, one(4, 4, 4, 0)], [1, 0, one(8, 2, 1, 5)]]), 64, 64)).toBe(true);
    const L = log.lines(), w = L.find(l => l.startsWith('result#7 [part D0] whole')), n = L.find(l => l.startsWith('result#7 [part D0] native'));
    expect(L[0]).toContain('parts\' rays in the loop'); expect(L[1]).toMatch(/^legend: /); expect(L[1]).toContain('stepping across the part\'s rect');
    expect(L.find(l => l.startsWith('status: '))).toBe('status: 2 probe rounds (1 with no part in the frame), most parts in a frame 2, windows decoded 2, probes that found the program still being made 1, probes skipped for a read not done 2');
    expect(w).toContain('2 rays'); expect(w).toContain('loops/ray mean 6 '); expect(w).toContain('total 12/window'); expect(w).toContain('partOcc skips/ray 3 (before the 1st read 2.5;'); expect(w).toContain('skip-only rays 1 (50%'); expect(w).not.toContain('tiles');
    expect(n).toContain('tiles 64: skip-only 0'); expect(n).toContain('mixed 1'); expect(n).toContain('empty 63');
    expect(ppLabel({ kind: 2, id: 3 })).toBe('child#3');
  });
  it('a window that is not decodable is not added; a note is kept once; a part with no ray marched says so', () => {
    const log = createPartProbeLog(); expect(log.add(part, 'whole', new Uint32Array(3), 64, 64)).toBe(false); expect(log.size).toBe(0);
    log.note('x failed'); log.note('x failed'); expect(log.lines().filter(l => l.startsWith('note: '))).toEqual(['note: x failed']);
    const miss = new Uint32Array(64 * 64 * PP_STRIDE); miss[0] = 4; log.add({ kind: 2, id: 1 }, 'whole', miss, 64, 64);
    expect(log.lines().find(l => l.startsWith('child#1'))).toContain('no ray marched (miss 1 px)');
  });
});

describe('host: the parts\' counting probe', () => {
  const tex = (w) => { const t = new THREEG.Data3DTexture(new Uint8Array(w * w * w * 4), w, w, w); t.format = THREEG.RGBAFormat; t.type = THREEG.UnsignedByteType; t.needsUpdate = true; return t; };
  const partU = (u, kind = 1, id = 7) => { const o = sceneUniforms(16); for (const k of Object.keys(u)) if (!(k in o)) o[k] = u[k]; return Object.assign(o, { regionTex: { value: tex(4) }, partField: { value: tex(2) }, partOcc: { value: tex(2) }, partKind: { value: kind }, partId: { value: id }, partMask: { value: 1 }, boxH: { value: new THREEG.Vector3(0.5, 0.5, 0.5) }, boxEntry: { value: 1 } }); };
  const mk = () => { const rec = recordingDevice({}); return { rec, r: createVrVolumeRenderer({ THREE: THREEG, device: rec.device, halfExt: [1, 1, 1], bgDelayMs: 0 }) }; };
  const frame = (r, u, extras) => { r.draw({ u, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 0.5, fov: false, fp: 0.5, rects: null, band: 1, variant: { cls4: false, events: false }, extras }); return r.volume.markFrame(); };
  it('nothing while the breakdown does not record or a frame had no part; the first probe of a part starts its program (pending), the next one draws it: one 64 x 64 pass of the part\'s own uniforms with the part twin, no tiles, its own buffers, 21 u32 a pixel', withGpu(async () => {
    const { rec, r } = mk(), u = sceneUniforms(16), pu = partU(u), M2 = new THREEG.Matrix4().makeTranslation(0.5, 0, 0);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]);
    expect((await r.breakdown.partProbe('whole')).items).toEqual([]); // not recording
    await r.breakdown.begin({ cls4: false, events: false }, () => {});
    frame(r, u, null); expect(await r.breakdown.partProbe('whole')).toMatchObject({ items: [], parts: 0 }); // a frame of the body alone
    const ex = [{ u: pu, model: M2, order: 1.5, boxes: null }];
    const f1 = frame(r, u, ex); expect(await r.breakdown.partProbe('whole', f1)).toMatchObject({ items: [], parts: 1, pending: 1 }); // the program is being made
    await settle();
    const n0 = rec.log.length, f2 = frame(r, u, ex), res = (await r.breakdown.partProbe('whole', f2)).items;
    expect(res).toHaveLength(1); expect(res[0]).toMatchObject({ part: { kind: 1, id: 7 }, kind: 'whole', w: 64, h: 64 }); expect(res[0].counters).toBeInstanceOf(Uint32Array); expect(res[0].counters.length).toBe(64 * 64 * PP_STRIDE);
    const code = rec.stats.shaders.find(c => c.includes('counters=part')); expect(code).toBeTruthy(); expect(code).toContain('gPS+=1u'); expect(code).toContain('var partOcc:');
    const after = rec.log.slice(n0), probePass = after.filter(l => l.startsWith('beginRenderPass')); expect(probePass.length).toBeGreaterThanOrEqual(2); // the frame's own pass(es), then the probe's
    expect(after.filter(l => l.startsWith('copyBufferToBuffer') && l.endsWith(' ' + 64 * 64 * PP_STRIDE * 4))).toHaveLength(1);
    expect(after.some(l => l.startsWith('clearBuffer'))).toBe(true);
    r.breakdown.end(); r.dispose();
  }));
  it('native and whole put the window on the part: the part\'s matrices are used (not the body\'s); the probe of a second kind and a second part are all drawn in one call, a part is probed again once its read is done', withGpu(async () => {
    const { rec, r } = mk(), u = sceneUniforms(16), pa = partU(u, 1, 7), pb = partU(u, 2, 9), M2 = new THREEG.Matrix4().makeTranslation(0.5, 0, 0), M3 = new THREEG.Matrix4().makeTranslation(-0.5, 0, 0);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]);
    await r.breakdown.begin({ cls4: false, events: false }, () => {});
    const ex = [{ u: pa, model: M2, order: 1.5, boxes: null }, { u: pb, model: M3, order: 1.5, boxes: null }];
    let f = frame(r, u, ex); await r.breakdown.partProbe('whole', f); await settle();
    f = frame(r, u, ex); const both = (await r.breakdown.partProbe('native', f)).items;
    expect(both.map(x => x.part.id).sort()).toEqual([7, 9]); expect(both.every(x => x.kind === 'native')).toBe(true);
    f = frame(r, u, ex); expect((await r.breakdown.partProbe('whole', f)).items.length).toBe(2); // the busy flag is let go after the read
    expect(rec.stats.shaders.filter(c => c.includes('counters=part')).length).toBe(1); // one program for the two parts (the same variant)
    r.breakdown.end(); expect((await r.breakdown.partProbe('whole')).items).toEqual([]); r.dispose();
  }));
  it('a variant that has no parts\' block (no feat P) gives a note, never a throw; the display\'s own frame after the breakdown is over has no part probe state', withGpu(async () => {
    const { r } = mk(), u = sceneUniforms(16), plain = sceneUniforms(16); for (const k of Object.keys(u)) if (!(k in plain)) plain[k] = u[k]; Object.assign(plain, { partKind: { value: 1 }, partId: { value: 1 } });
    await r.preload(u, [{ cls4: false, events: false, multi: true }]);
    await r.breakdown.begin({ cls4: false, events: false }, () => {});
    const f = frame(r, u, [{ u: plain, model: new THREEG.Matrix4().makeTranslation(0.5, 0, 0), order: 1.5, boxes: null }]);
    const res = (await r.breakdown.partProbe('whole', f)).items; expect(res).toHaveLength(1); expect(res[0].note).toMatch(/part counting program/);
    r.breakdown.end(); r.dispose();
  }));
  it('a program that does not compile is reported once as a note (and never again), the probe then gives nothing; the shader diagnostics get a key of their own', withGpu(async () => {
    const { rec, r } = mk(), u = sceneUniforms(16), pu = partU(u), M2 = new THREEG.Matrix4().makeTranslation(0.5, 0, 0);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]);
    await r.breakdown.begin({ cls4: false, events: false }, () => {});
    const real = rec.device.createRenderPipelineAsync; rec.device.createRenderPipelineAsync = async d => { if (d.layout && rec.stats.shaders.at(-1)?.includes('counters=part')) throw new Error('boom: invalid WGSL'); return real(d); };
    const ex = [{ u: pu, model: M2, order: 1.5, boxes: null }];
    let f = frame(r, u, ex); expect((await r.breakdown.partProbe('whole', f)).pending).toBe(1); await settle(); await settle();
    f = frame(r, u, ex); const a = await r.breakdown.partProbe('whole', f); expect(a.items).toHaveLength(1); expect(a.items[0].note).toMatch(/did not compile: boom: invalid WGSL/);
    f = frame(r, u, ex); const b = await r.breakdown.partProbe('whole', f); expect(b.items).toEqual([]); expect(b.busy).toBe(1); // reported once
    r.breakdown.end(); r.dispose();
  }));
  it('the native window steps across the part\'s rect: two native probes of one part are drawn with different matrices (the whole window does not move)', withGpu(async () => {
    const { rec, r } = mk(), u = sceneUniforms(16), pu = partU(u), M2 = new THREEG.Matrix4().makeTranslation(0.5, 0, 0);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]);
    await r.breakdown.begin({ cls4: false, events: false }, () => {});
    const ex = [{ u: pu, model: M2, order: 1.5, boxes: null }];
    let f = frame(r, u, ex); await r.breakdown.partProbe('whole', f); await settle();
    const writes = async kind => { f = frame(r, u, ex); const n0 = rec.log.length; const o = await r.breakdown.partProbe(kind, f); expect(o.items).toHaveLength(1); return rec.log.slice(n0).filter(l => l.startsWith('writeBuffer') && +l.split(' ')[3] > 256).join('|'); };
    const w1 = await writes('whole'), w2 = await writes('whole'), n1 = await writes('native'), n2 = await writes('native'), n3 = await writes('native');
    expect(w1).toBe(w2); expect(new Set([n1, n2, n3]).size).toBeGreaterThan(1);
    r.breakdown.end(); r.dispose();
  }));
});
