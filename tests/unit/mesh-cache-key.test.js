import { describe, it, expect } from 'vitest';
import { runSurfaceMeshKey, baseMeshKey, runsDigest, sliceContentDigest, MESH_FORMAT } from '../../docs/mesh-cache-key.js';
import { segmentRunsCacheKey, segmentKeyFields } from '../../docs/segment-cache-key.js';

const series = () => ({
  id: 'series-1', description: 'phantom', modality: 'CT', columns: 64, rows: 48, spacingX: 0.1, spacingY: 0.1, spacingZ: 0.12,
  slices: Array.from({ length: 24 }, () => ({ studyUid: '1.2.3', seriesUid: '1.2.3.4' })),
});
const seg = () => ({ min: -250, max: -50, opening: 0, closing: 0, minComponent: 0, holeFill: false, surfaceMm: 0.3, thicknessMm: 0, color: '#e7c85d', opacity: 1 });
const route = () => ({ smooth: true, chunkFloats: 8 * 2 ** 20, halo: 16, touch: false });
const common = () => ({
  series: series(), content: 'c'.repeat(64), filter: 'g:0.6', smoothing: { enabled: true, strength: 0.6 }, resolution: 512, route: route(),
  exclusive: { mode: 'priority', order: ['contrast', 'bone', 'fat', 'soft', 'lung'] },
});
const runInputs = () => ({ ...common(), key: 'fat', seg: seg(), sources: '', memoryPath: false, runsHash: 'a'.repeat(64) });
const baseInputs = () => ({ ...common(), segments: [{ key: 'bone', seg: { ...seg(), min: 500, max: 1500 } }, { key: 'fat', seg: seg() }] });

// each case changes ONE input of a valid key input: the key must change (a key that ignores an input would show an old mesh)
const changes = {
  'dataset: series id': i => { i.series.id = 'series-2'; },
  'dataset: study uid': i => { i.series.slices[0].studyUid = '9.9'; },
  'dataset: series uid': i => { i.series.slices[0].seriesUid = '9.9'; },
  'dataset: columns': i => { i.series.columns = 65; },
  'dataset: rows': i => { i.series.rows = 49; },
  'dataset: slice count': i => { i.series.slices.pop(); },
  'dataset: spacing x': i => { i.series.spacingX = 0.11; },
  'dataset: spacing z': i => { i.series.spacingZ = 0.2; },
  'file content digest': i => { i.content = 'd'.repeat(64); },
  'filter signature': i => { i.filter = 'g:0.7'; },
  'filter off': i => { i.filter = ''; },
  'smoothing on/off': i => { i.smoothing.enabled = false; },
  'smoothing strength': i => { i.smoothing.strength = 2.5; },
  '3D resolution': i => { i.resolution = 768; },
  'route: smoothing on/off': i => { i.route.smooth = false; },
  'route: touch': i => { i.route.touch = true; },
  'route: chunk size': i => { i.route.chunkFloats = 4 * 2 ** 20; },
  'route: halo': i => { i.route.halo = 8; },
  'route: a new device field': i => { i.route.gpu = true; },
  'overlap mode': i => { i.exclusive.mode = 'off'; },
  'overlap priority order': i => { i.exclusive.order = ['bone', 'contrast', 'fat', 'soft', 'lung']; },
};
const segChanges = {
  'range min': s => { s.min = -300; },
  'range max': s => { s.max = 0; },
  'opening': s => { s.opening = 1; },
  'closing': s => { s.closing = 2; },
  'minimum component': s => { s.minComponent = 100; },
  'hole fill': s => { s.holeFill = true; },
  'air boundary (surfaceMm)': s => { s.surfaceMm = 0.5; },
  'thin part (thicknessMm)': s => { s.thicknessMm = 0.2; },
};

describe('mesh cache key: run surface', () => {
  it('is a stable SHA-256 hex string', async () => {
    const a = await runSurfaceMeshKey(runInputs());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await runSurfaceMeshKey(runInputs())).toBe(a);
  });
  it('ignores what is not geometry (colour, opacity)', async () => {
    const a = await runSurfaceMeshKey(runInputs()), i = runInputs();
    i.seg.color = '#000000'; i.seg.opacity = 0.4;
    expect(await runSurfaceMeshKey(i)).toBe(a);
  });
  for (const [name, change] of Object.entries(changes)) {
    it('changes with ' + name, async () => {
      const a = await runSurfaceMeshKey(runInputs()), i = runInputs(); change(i);
      expect(await runSurfaceMeshKey(i)).not.toBe(a);
    });
  }
  for (const [name, change] of Object.entries(segChanges)) {
    it('changes with the segment setting: ' + name, async () => {
      const a = await runSurfaceMeshKey(runInputs()), i = runInputs(); change(i.seg);
      expect(await runSurfaceMeshKey(i)).not.toBe(a);
    });
  }
  it('changes with the segment (which one it is)', async () => {
    const i = runInputs(); i.key = 'soft';
    expect(await runSurfaceMeshKey(i)).not.toBe(await runSurfaceMeshKey(runInputs()));
  });
  it('changes with the voxel takers above (overlap exclusion)', async () => {
    const i = runInputs(); i.sources = 'bone:500,1500,0,0,0,0,0,0,0[]';
    expect(await runSurfaceMeshKey(i)).not.toBe(await runSurfaceMeshKey(runInputs()));
  });
  it('changes with the in-memory / device run path', async () => {
    const i = runInputs(); i.memoryPath = true;
    expect(await runSurfaceMeshKey(i)).not.toBe(await runSurfaceMeshKey(runInputs()));
  });
  it('changes with the final runs it is built from', async () => {
    const i = runInputs(); i.runsHash = 'b'.repeat(64);
    expect(await runSurfaceMeshKey(i)).not.toBe(await runSurfaceMeshKey(runInputs()));
  });
  it('is not the key of the same inputs as a base mesh or as the segment runs', async () => {
    const run = await runSurfaceMeshKey(runInputs()), base = await baseMeshKey(baseInputs());
    expect(run).not.toBe(base);
    expect(run).not.toBe(await segmentRunsCacheKey(series(), 'g:0.6', seg()));
  });
  for (const name of ['series', 'content', 'smoothing', 'route', 'exclusive', 'key', 'seg', 'runsHash']) {
    it('refuses to make a key without ' + name, () => {
      const i = runInputs(); delete i[name];
      expect(() => runSurfaceMeshKey(i)).toThrow(/missing/);
    });
  }
  it('refuses a key without smoothing strength or overlap order', () => {
    const a = runInputs(); delete a.smoothing.strength; expect(() => runSurfaceMeshKey(a)).toThrow(/missing/);
    const b = runInputs(); delete b.exclusive.order; expect(() => runSurfaceMeshKey(b)).toThrow(/missing/);
  });
});

describe('mesh cache key: base surface', () => {
  it('is stable', async () => {
    const a = await baseMeshKey(baseInputs());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await baseMeshKey(baseInputs())).toBe(a);
  });
  for (const [name, change] of Object.entries(changes)) {
    it('changes with ' + name, async () => {
      const a = await baseMeshKey(baseInputs()), i = baseInputs(); change(i);
      expect(await baseMeshKey(i)).not.toBe(a);
    });
  }
  for (const [name, change] of Object.entries(segChanges)) {
    it('changes with the setting of a segment: ' + name, async () => {
      const a = await baseMeshKey(baseInputs()), i = baseInputs(); change(i.segments[1].seg);
      expect(await baseMeshKey(i)).not.toBe(a);
    });
  }
  it('changes with the set, the order and the names of the segments', async () => {
    const a = await baseMeshKey(baseInputs());
    const fewer = baseInputs(); fewer.segments.pop();
    const swapped = baseInputs(); swapped.segments.reverse();
    const renamed = baseInputs(); renamed.segments[1].key = 'soft';
    const more = baseInputs(); more.segments.push({ key: 'lung', seg: { ...seg(), min: -900, max: -500 } });
    for (const i of [fewer, swapped, renamed, more]) expect(await baseMeshKey(i)).not.toBe(a);
  });
  it('refuses a key without segments', () => {
    const i = baseInputs(); i.segments = [];
    expect(() => baseMeshKey(i)).toThrow();
    const j = baseInputs(); delete j.segments; expect(() => baseMeshKey(j)).toThrow(/missing/);
  });
});

describe('mesh format and the existing runs key', () => {
  it('has a positive integer generation version', () => {
    expect(Number.isInteger(MESH_FORMAT) && MESH_FORMAT > 0).toBe(true);
  });
  it('segmentKeyFields lists every segment setting the runs key uses', () => {
    expect(Object.keys(segmentKeyFields(seg()))).toEqual(['min', 'max', 'opening', 'closing', 'minComponent', 'holeFill', 'surfaceMm', 'thicknessMm']);
  });
  // the segment-runs cache must keep hitting the entries already stored on devices: its key text did not change with the
  // mesh cache (this hash was computed before segmentKeyFields was factored out)
  it('leaves the segment-runs cache key unchanged', async () => {
    expect(await segmentRunsCacheKey(series(), 'g:0.6', seg(), { sources: 'bone:1' })).toBe('45e74adb4865fd45edb0857104c71abab8dd0a5ad59ea07393231b2f51d2676f');
    // values of other types (a string number, a truthy flag, an unset field) are coerced exactly as before
    expect(await segmentRunsCacheKey(series(), '', { min: 1, max: 2, opening: 1, closing: 0, minComponent: 5, holeFill: 1, surfaceMm: '0.5', thicknessMm: undefined })).toBe('b87c953e83f40552d31260197f7409c89e830d8c1a0aa9fff437be83b288d605');
  });
});

describe('runsDigest', () => {
  const runs = () => [new Uint32Array([1, 2, 3]), null, new Uint32Array([4, 5, 6, 7, 8, 9])];
  it('is stable and follows the voxels', async () => {
    const a = await runsDigest(runs());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await runsDigest(runs())).toBe(a);
    const moved = runs(); moved[0][2] = 4;
    expect(await runsDigest(moved)).not.toBe(a);
    const moreSlices = [...runs(), new Uint32Array(0)];
    expect(await runsDigest(moreSlices)).not.toBe(a);
  });
});

describe('sliceContentDigest', () => {
  const withFiles = sizes => ({ slices: sizes.map(size => ({ file: { size }, slope: 1, intercept: -1024, bits: 16, signed: true, ts: '1.2.840.10008.1.2.1' })) });
  it('is stable and follows the files and how they are decoded', async () => {
    const a = await sliceContentDigest(withFiles([100, 200, 300]));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sliceContentDigest(withFiles([100, 200, 300]))).toBe(a);
    expect(await sliceContentDigest(withFiles([100, 200, 301]))).not.toBe(a);
    expect(await sliceContentDigest(withFiles([100, 200]))).not.toBe(a);
    const slope = withFiles([100, 200, 300]); slope.slices[1].slope = 2;
    expect(await sliceContentDigest(slope)).not.toBe(a);
    const icpt = withFiles([100, 200, 300]); icpt.slices[0].intercept = 0;
    expect(await sliceContentDigest(icpt)).not.toBe(a);
  });
  it('does not fail on slices without a file', async () => {
    expect(await sliceContentDigest({ slices: [{}] })).toMatch(/^[0-9a-f]{64}$/);
    expect(await sliceContentDigest({})).toMatch(/^[0-9a-f]{64}$/);
  });
});
