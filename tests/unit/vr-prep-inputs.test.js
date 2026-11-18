import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { volumeMeta, editDescsOf, regionItemsOf, childItemsOf, shownMask, shownRegions, shownChildren, classifyStateOf, vrUnitsPerMm, VR_TARGET_SIDE } from '../../docs/vr-prep-inputs.js';
import { volumeTexturePlan } from '../../docs/medical-volume.js';
import { marchStep } from '../../docs/vr-auto-quality.js';
import { unionRunArrays, subtractRunArrays } from '../../docs/run-length.js';
import { prepRun } from '../../docs/vr-volume-prep.js';

// Stage 1 of the sample pairs: what the VR preparation reads is ONE input object (docs/vr-prep-inputs.js) instead of the page's globals. The primary volume's prepared data P must stay BYTE-IDENTICAL, so the reference below is the
// code of docs/vr-view.js as it was before (editDescsOf / volumeMeta / regionItemsOf / childItemsOf / shownMask / the state of prepareVrData, copied verbatim with the globals injected through G), and every answer of the new
// functions is compared with it - down to the bytes of the worker's classification job (prepRun 'cls') made from them.

const ORDER = ['bone', 'soft', 'fat', 'lung'], KEYS = ['bone', 'soft', 'fat', 'lung', 'contrast'];
const COLS = 24, ROWS = 20, SL = 16;
const series = { id: 'S1', columns: COLS, rows: ROWS, slices: Array.from({ length: SL }, () => ({ signed: false, slope: 1, intercept: -1024 })), spacingX: 0.5, spacingY: 0.5, spacingZ: 1.25, description: 'fixture' };
const volume = { sourceBacked: true, series, columns: COLS, rows: ROWS, slices: SL, spacing: [0.5, 0.5, 1.25] };
// per-slice runs [y, x0, x1, ...] of a box
const box = (z0, z1, y0, y1, x0, x1) => Array.from({ length: SL }, (_, z) => (z >= z0 && z <= z1 ? Uint32Array.from(Array.from({ length: y1 - y0 + 1 }, (_, i) => [y0 + i, x0, x1]).flat()) : null));
const segState = () => ({ bone: { active: true, enabled: true, min: 300, max: 3000 }, soft: { active: true, enabled: false, min: -100, max: 299 }, fat: { active: false, enabled: false, min: -200, max: -101 }, lung: { active: true, enabled: true, min: -900, max: -300 }, contrast: { active: true, enabled: true, min: 3001, max: 4000 } });
const edits = () => ({ bone: { mode: 'exclude', runs: box(2, 5, 3, 8, 4, 9), maskOnly: false }, soft: { mode: 'keep', runs: box(1, 9, 1, 15, 1, 20), maskOnly: true }, lung: { mode: 'keep', runs: box(0, 3, 0, 4, 0, 4) } });
const kids = () => [
  { key: 'c1', runs: box(2, 4, 4, 6, 5, 7), voxels: 27, parentKey: 'bone', hash: 'h1' },
  { key: 'c2', runs: box(1, 2, 2, 3, 2, 3), voxels: 8, parentKey: 'soft', hash: 'h2' },
  { key: 'c3', runs: null, voxels: 0, parentKey: 'bone', hash: 'h3' },
  { key: 'c4', runs: box(0, 1, 0, 1, 0, 1), voxels: 8, parentKey: 'fat', hash: 'h4' },
];
const regions = () => [
  { id: 4, color: 0xff3300, segmentKeys: ['bone'], runsBySlice: box(3, 6, 5, 9, 6, 12), voxels: 100, mm3: 31.25 },
  { id: 5, color: 0x2255ff, segmentKeys: ['soft', 'fat'], runsBySlice: box(0, 2, 2, 6, 2, 6), voxels: 60, mm3: 18.75 },
  { id: 6, color: 0x22ff55, segmentKeys: ['fat'], runsBySlice: box(0, 2, 2, 6, 2, 6), voxels: 60, mm3: 18.75 }, // only an unavailable segment: not prepared
  { id: 7, color: 0xffffff, segmentKeys: [], runsBySlice: box(7, 8, 7, 9, 7, 9), voxels: 18, mm3: 5 }, // no segment keys: always prepared
  { id: 8, color: 0x123456, segmentKeys: ['bone'], runsBySlice: null, voxels: 5, mm3: 1 }, // no runs
  { id: 9, color: 0x654321, segmentKeys: ['lung'], runsBySlice: box(7, 8, 7, 9, 7, 9), voxels: 0, mm3: 0 }, // no voxels
];

// ---- the reference: docs/vr-view.js before stage 1 (verbatim bodies, globals read through G)
function reference(G) {
  const segAvail = g => !!g?.active && (!!g.enabled || G.eventMode);
  const gpuSegmentOrder = () => G.order, segmentState = G.segmentState, segMode = G.segMode;
  const shownRegions = () => G.regions.filter(r => (!r.segmentKeys?.length || r.segmentKeys.some(k => segAvail(segmentState[k]))) && r.runsBySlice && r.voxels > 0);
  const shownChildren = () => G.childEntries.filter(c => c.runs && c.voxels > 0 && segAvail(segmentState[c.parentKey]));
  const childItemsOf = () => { const sk = gpuSegmentOrder(); return shownChildren().map(c => { const sl = sk.indexOf(c.parentKey); return { key: c.key, segMask: sl >= 0 ? 1 << sl : 0, runsBySlice: c.runs, hash: c.hash }; }); };
  const regionItemsOf = () => {
    const slotKeys = gpuSegmentOrder();
    return shownRegions().map(r => ({ color: r.color, segMask: (r.segmentKeys || []).reduce((m, key) => { const sl = slotKeys.indexOf(key); return sl >= 0 ? m | (1 << sl) : m; }, 0), runsBySlice: r.runsBySlice, mm3: r.mm3, segmentKeys: [...(r.segmentKeys || [])], rid: r.id }));
  };
  const shownMask = () => { let mask = 0; const slotKeys = gpuSegmentOrder(); for (let i = 0; i < 4; i++) { const key = slotKeys[i], seg = segmentState[key]; if (segAvail(seg) && segMode[key] !== 2) mask |= 1 << i; } return mask; };
  const editDescsOf = () => {
    const v = G.volume; if (!v) return null;
    const descs = G.editDescs, out = [];
    const kidRuns = new Map(); for (const c of shownChildren()) { const d = v.slices, cur = kidRuns.get(c.parentKey); kidRuns.set(c.parentKey, cur ? unionRunArrays(cur, c.runs, d) : c.runs); }
    gpuSegmentOrder().forEach((key, si) => { const desc = descs[key]; if (!desc?.runs) return; const kr = kidRuns.get(key); let runs = desc.runs; if (kr) runs = desc.mode === 'keep' ? unionRunArrays(runs, kr, v.slices) : subtractRunArrays(runs, kr, v.slices); out.push({ si, mode: desc.mode, maskOnly: !!desc.maskOnly, runs }); });
    return { descs: out, sourceDims: [v.columns, v.rows, v.slices] };
  };
  const volumeMeta = maxDim => {
    const v = G.volume, s = v?.series;
    if (!v?.sourceBacked || !s) throw new Error('VR: open a DICOM series first');
    const plan = volumeTexturePlan(v, 0, maxDim, 512), [tw, th, td] = plan.dims, first = s.slices[0], signed = !!first.signed;
    const slope = first.slope || 1, intercept = first.intercept || 0, bias = signed ? 32768 : 0, calibration = [slope, intercept, bias];
    const px = s.columns * s.spacingX, py = s.rows * s.spacingY, pz = s.slices.length * s.spacingZ, maxP = Math.max(px, py, pz, 1), scale = 3.3 / maxP;
    const halfExt = [px * scale * .5, py * scale * .5, pz * scale * .5], step = marchStep(halfExt, [tw, th, td]);
    return { v, s, plan, dims: [tw, th, td], first, signed, calibration, halfExt, step, filtered: !!(v.filterSignature && typeof v.sliceData === 'function') };
  };
  // prepareVrData: the state of the worker's classification
  const classifyState = vrSegments => { const order = gpuSegmentOrder(), segs = vrSegments, state = {}; for (const k of order.slice(0, 4)) { const g = segs[k]; state[k] = g ? { active: !!g.active, enabled: !!g.enabled, min: g.min, max: g.max } : undefined; } return state; };
  return { shownRegions, shownChildren, childItemsOf, regionItemsOf, shownMask, editDescsOf, volumeMeta, classifyState };
}
// the page's input is getters over its globals; here the same shape over G, counting the reads
const inputOf = (G, extra = {}) => {
  const reads = [];
  const inp = {
    get volume() { reads.push('volume'); return G.volume; }, get order() { reads.push('order'); return G.order; }, get segments() { reads.push('segments'); return G.segmentState; },
    get eventMode() { reads.push('eventMode'); return G.eventMode; }, get segMode() { reads.push('segMode'); return G.segMode; }, get vrSegments() { reads.push('vrSegments'); return G.eventMode ? Object.fromEntries(KEYS.map(k => [k, { ...G.segmentState[k], enabled: !!G.segmentState[k]?.active }])) : G.segmentState; },
    get editDescs() { reads.push('editDescs'); return G.editDescs; }, get children() { reads.push('children'); return G.childEntries; }, get regions() { reads.push('regions'); return G.regions; },
    ...extra,
  };
  return { inp, reads };
};
const world = (over = {}) => ({ volume, order: ORDER, segmentState: segState(), segMode: {}, eventMode: false, editDescs: edits(), childEntries: kids(), regions: regions(), ...over });
const CASES = {
  'plain page': world(),
  'event mode (a segment with its checkbox off counts)': world({ eventMode: true }),
  'a segment hidden in VR (segMode 2)': world({ segMode: { bone: 2 } }),
  'event mode, soft hidden in VR': world({ eventMode: true, segMode: { soft: 2, lung: 2 } }),
  'a slot order with the 5th preset (contrast takes the slot of the fat)': world({ order: ['bone', 'soft', 'contrast', 'lung'] }),
  'no edits / children / regions': world({ editDescs: {}, childEntries: [], regions: [] }),
  'no volume': world({ volume: null }),
};

describe('vr-prep-inputs.js: the same answers as the page code of before stage 1', () => {
  for (const [name, G] of Object.entries(CASES)) {
    it(name, () => {
      const R = reference(G), { inp } = inputOf(G);
      expect(shownMask(inp)).toBe(R.shownMask());
      expect(shownRegions(inp)).toEqual(R.shownRegions());
      expect(shownChildren(inp)).toEqual(R.shownChildren());
      expect(childItemsOf(inp)).toEqual(R.childItemsOf());
      expect(regionItemsOf(inp)).toEqual(R.regionItemsOf());
      expect(editDescsOf(inp)).toEqual(R.editDescsOf());
      expect(classifyStateOf(inp)).toEqual(R.classifyState(inp.vrSegments));
      if (G.volume) { const a = volumeMeta(inp, 256), b = R.volumeMeta(256); expect(a).toEqual(b); expect(Object.keys(a)).toEqual(Object.keys(b)); }
      else { expect(() => volumeMeta(inp, 256)).toThrow('VR: open a DICOM series first'); expect(editDescsOf(inp)).toBe(null); }
    });
  }

  it('the answers are the same OBJECTS the page code handed over (no copy of the runs)', () => {
    const G = world(), { inp } = inputOf(G);
    expect(regionItemsOf(inp)[0].runsBySlice).toBe(G.regions[0].runsBySlice);
    expect(childItemsOf(inp)[0].runsBySlice).toBe(G.childEntries[0].runs);
    expect(editDescsOf(inp).descs.find(d => d.si === 3).runs).toBe(G.editDescs.lung.runs);
  });

  it('the worker classification job made from them is byte-identical (every output of prepRun cls), in every case', () => {
    const dims = [12, 10, 8], n = dims[0] * dims[1] * dims[2] * 2, calib = [1, -1024, 0];
    const mk = () => { const a = new Uint8Array(n); for (let i = 0; i < a.length; i++) a[i] = (i * 37 + (i >> 5) * 11) & 255; return a; };
    const jobOf = (G, items, state) => ({ t: 'cls', id: 1, src: mk().buffer, dims, calib, editDescs: items.ed ? items.ed.descs : [], editSourceDims: items.ed ? items.ed.sourceDims : dims, regionItems: items.regions, order: G.order, state, childItems: items.children, brickDimsFull: [4, 3, 2], brickDimsHalf: null, mask: items.mask });
    const run = job => { let out = null; prepRun(job, m => { if (m.t !== 'progress') out = m; }); return out; };
    for (const [name, G] of Object.entries(CASES)) {
      if (!G.volume) continue;
      const R = reference(G), { inp } = inputOf(G);
      const oldEd = R.editDescsOf();
      const a = run(jobOf(G, { ed: editDescsOf(inp), regions: regionItemsOf(inp), children: childItemsOf(inp), mask: shownMask(inp) }, classifyStateOf(inp)));
      const b = run(jobOf(G, { ed: oldEd, regions: oldEd ? R.regionItemsOf() : [], children: oldEd ? R.childItemsOf() : [], mask: R.shownMask() }, R.classifyState(inp.vrSegments)));
      expect(a.warnings, name).toEqual([]);
      expect(a, name).toEqual(b);
      if (name === 'plain page') { expect(a.edit.active).toBeGreaterThan(0); expect(a.region.list.length).toBeGreaterThan(0); expect(a.child.list.length).toBeGreaterThan(0); expect(a.cls).not.toBe(null); expect(a.combo.length).toBeGreaterThan(0); } // not an empty-equals-empty comparison
    }
  });

  it('nothing is read at entry and the init hook is never called by the functions (the page order: the volume first, initialVrModes, then the segment state)', () => {
    const G = world(); let called = 0;
    const { inp, reads } = inputOf(G, { initModes: () => { called++; reads.push('initModes'); } });
    shownMask(inp); expect(reads.sort()).toEqual(['eventMode', 'order', 'segMode', 'segments'].sort());
    reads.length = 0; volumeMeta(inp, 256); expect(reads).toEqual(['volume']);
    reads.length = 0; childItemsOf(inp); expect(reads.includes('regions')).toBe(false); expect(reads.includes('editDescs')).toBe(false);
    expect(called).toBe(0);
  });
});

describe('volumeMeta: the mm scale', () => {
  const pxOf = s => [s.columns * s.spacingX, s.rows * s.spacingY, s.slices.length * s.spacingZ];
  it('without unitsPerMm every volume is on its own scale (longest side 3.3), exactly as before', () => {
    const { inp } = inputOf(world()), m = volumeMeta(inp, 256), mx = Math.max(...pxOf(series), 1);
    expect(Math.max(...m.halfExt) * 2).toBeCloseTo(3.3, 12);
    expect(m.halfExt).toEqual(pxOf(series).map(p => p * (3.3 / mx) * .5));
    expect(vrUnitsPerMm(series)).toBe(3.3 / mx);
  });
  it('with the primary\'s unitsPerMm the partner keeps the real size ratio', () => {
    const primary = { ...series, id: 'P', columns: 60, rows: 50, spacingX: 0.25, spacingY: 0.25, spacingZ: 0.25 }; // 15 x 12.5 x 4 mm
    const partner = { ...series, id: 'Q', columns: 30, rows: 20, spacingX: 0.5, spacingY: 0.5, spacingZ: 0.5 }; // 15 x 10 x 4 mm
    const upm = vrUnitsPerMm(primary);
    const mp = volumeMeta(inputOf(world({ volume: { ...volume, series: primary, columns: 60, rows: 50, slices: 16 } })).inp, 256);
    const mq = volumeMeta(inputOf(world({ volume: { ...volume, series: partner, columns: 30, rows: 20, slices: 16 } }), { unitsPerMm: upm }).inp, 256);
    expect(mq.halfExt[0]).toBe(mp.halfExt[0]); // both 15 mm wide
    expect(mq.halfExt[1] / mp.halfExt[1]).toBeCloseTo(10 / 12.5, 12);
    expect(mp.halfExt).toEqual(volumeMeta(inputOf(world({ volume: { ...volume, series: primary, columns: 60, rows: 50, slices: 16 } })).inp, 256).halfExt); // the primary is not touched by the partner's value
    expect(VR_TARGET_SIDE).toBe(512);
  });
});

describe('vr-view.js uses the input object', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the preparation takes inp; the page wraps it (pageInputs is getters, one object, nothing allocated per call)', () => {
    expect(src).toMatch(/async function prepareVrDataFrom\(inp,/);
    expect(src).toMatch(/const promise=prepareVrDataFrom\(pageInputs,\{key,fresh,aliasId:globalThis\.__vrlOpenSample\|\|null,track:true,/);
    expect(src).toMatch(/async function buildVolumeData\(inp,maxDim,/);
    expect(src).toMatch(/const pageInputs=\{get volume\(\)\{return gpuVolumeTarget\(\)\}/);
    // the part of the preparation that follows prepareVrDataFrom reads no page global for the data (the volume, the segments, the results): only inp
    const body = src.slice(src.indexOf('async function prepareVrDataFrom('), src.indexOf('// classification bytes for the 3D position-comment markers'));
    for (const g of ['gpuVolumeTarget(', 'segmentState', 'analysisRegions', 'gpuSegmentOrder(', 'vrSegments(', 'initialVrModes(', 'childRenderEntries(', 'shownMask()', 'shownRegions()', 'shownChildren()']) expect(body, g).not.toContain(g);
    expect(src).not.toMatch(/function (editDescsOf|volumeMeta|regionItemsOf|childItemsOf)\(/);
  });
  it('the cache key of the prepared data does not name the build', () => {
    for (const line of src.split('\n')) if (/prep:VR_PREP_VERSION/.test(line) && /partsOf\(/.test(line)) expect(line).not.toContain('APP_BUILD');
  });
});
