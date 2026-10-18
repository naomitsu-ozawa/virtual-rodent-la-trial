import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  planeDims, sliceIndexFor, withSliceIndex, clampVoxel, clientToFraction, voxelFromPlanePoint, planePointFromVoxel,
  voxelToMm, sampleHu, formatHu, voxelToLocal3D,
} from '../../docs/crosshair.js';
import {
  setVolume, setSourceVolume, setCrosshair, getCrosshair, clearCrosshair, setCrosshairSlice, onCrosshairChange,
} from '../../docs/state.js';

// Screen position -> voxel -> millimetres for the three planes. The 2D canvas is stretched over its displayed rectangle,
// so a pixel maps to a voxel by fraction; spacing only changes the rectangle's aspect and the millimetre values.
const dims = { columns: 20, rows: 10, slices: 8 };
const PLANES = ['axial', 'coronal', 'sagittal'];
// the rectangle the app draws a plane in: physical size (voxels * spacing) scaled by `scale` pixels per mm (updateMprCanvasPhysicalAspect)
function rectFor(plane, spacing, scale = 40, left = 100, top = 50) {
  const [w, h] = planeDims(plane, dims);
  const [sx, sy, sz] = spacing;
  const pw = plane === 'axial' ? w * sx : plane === 'coronal' ? w * sx : w * sy, ph = plane === 'axial' ? h * sy : h * sz;
  return { left, top, width: pw * scale, height: ph * scale };
}
const centre = (rect, plane, v) => {
  const { fx, fy } = planePointFromVoxel(plane, v, dims);
  return { x: rect.left + fx * rect.width, y: rect.top + fy * rect.height };
};

describe('screen -> voxel -> mm, three planes', () => {
  for (const spacing of [[0.1, 0.1, 0.1], [0.1, 0.1, 0.2], [0.1, 0.1, 0.5], [0.08, 0.12, 0.4]]) {
    it(`spacing ${spacing.join('x')}: every voxel round-trips through its pixel centre in all planes`, () => {
      for (const plane of PLANES) {
        const rect = rectFor(plane, spacing);
        for (let i = 0; i < dims.columns; i += 3) for (let j = 0; j < dims.rows; j += 3) for (let k = 0; k < dims.slices; k += 3) {
          const v = { i, j, k }, { x, y } = centre(rect, plane, v);
          const { fx, fy } = clientToFraction(rect, x, y);
          expect(voxelFromPlanePoint(plane, fx, fy, dims, sliceIndexFor(plane, v)), `${plane} ${i},${j},${k}`).toEqual(v);
        }
      }
    });
  }

  it('axial: x -> i, y -> j, the slice is k; coronal: x -> i, y -> slices-1-k; sagittal: x -> j, y -> slices-1-k', () => {
    expect(voxelFromPlanePoint('axial', 0.51, 0.31, dims, 5)).toEqual({ i: 10, j: 3, k: 5 });
    expect(voxelFromPlanePoint('coronal', 0.51, 0.01, dims, 4)).toEqual({ i: 10, j: 4, k: 7 }); // top row = last slice
    expect(voxelFromPlanePoint('coronal', 0.51, 0.99, dims, 4)).toEqual({ i: 10, j: 4, k: 0 });
    expect(voxelFromPlanePoint('sagittal', 0.51, 0.51, dims, 6)).toEqual({ i: 6, j: 5, k: 3 });
  });

  it('mm is voxel index * spacing, and an anisotropic z (x2, x5) scales only z', () => {
    for (const sz of [0.1, 0.2, 0.5]) {
      const rect = rectFor('coronal', [0.1, 0.1, sz]), v = { i: 7, j: 2, k: 6 }, { x, y } = centre(rect, 'coronal', v);
      const got = voxelFromPlanePoint('coronal', ...Object.values(clientToFraction(rect, x, y)), dims, v.j);
      const mm = voxelToMm(got, [0.1, 0.1, sz]);
      expect(mm.x).toBeCloseTo(0.7, 10); expect(mm.y).toBeCloseTo(0.2, 10); expect(mm.z).toBeCloseTo(6 * sz, 10);
      // the vertical pixel position agrees with the physical size: the centre of voxel k is (slices - k - .5) * sz mm from the top
      expect((y - rect.top) / 40).toBeCloseTo((dims.slices - 6 - 0.5) * sz, 10);
    }
  });

  it('sagittal uses the row spacing horizontally and z vertically', () => {
    const sp = [0.3, 0.1, 0.5], rect = rectFor('sagittal', sp), v = { i: 4, j: 8, k: 2 }, { x, y } = centre(rect, 'sagittal', v);
    expect((x - rect.left) / 40).toBeCloseTo((8 + 0.5) * 0.1, 10);
    expect(voxelToMm(voxelFromPlanePoint('sagittal', ...Object.values(clientToFraction(rect, x, y)), dims, 4), sp)).toEqual({ x: 4 * 0.3, y: 8 * 0.1, z: 2 * 0.5 });
    expect(y).toBeGreaterThan(rect.top);
  });

  it('clamps points outside the image (a drag may leave it) into the data', () => {
    const rect = rectFor('axial', [0.1, 0.1, 0.1]);
    for (const [cx, cy] of [[-500, -500], [99999, 99999], [rect.left + rect.width, rect.top + rect.height]]) {
      const { fx, fy } = clientToFraction(rect, cx, cy), v = voxelFromPlanePoint('axial', fx, fy, dims, 3);
      expect(v.i).toBeGreaterThanOrEqual(0); expect(v.i).toBeLessThanOrEqual(dims.columns - 1);
      expect(v.j).toBeGreaterThanOrEqual(0); expect(v.j).toBeLessThanOrEqual(dims.rows - 1);
    }
    expect(voxelFromPlanePoint('axial', 1, 1, dims, 99)).toEqual({ i: 19, j: 9, k: 7 });
  });

  it('clampVoxel rounds, clamps and rejects junk; withSliceIndex changes one axis', () => {
    expect(clampVoxel({ i: -3, j: 99, k: 2.6 }, dims)).toEqual({ i: 0, j: 9, k: 3 });
    expect(clampVoxel({ i: 'x', j: 1, k: 1 }, dims)).toBeNull();
    expect(clampVoxel({ i: 1, j: 1, k: 1 }, null)).toBeNull();
    expect(clampVoxel(null, dims)).toBeNull();
    const v = { i: 1, j: 2, k: 3 };
    expect(withSliceIndex(v, 'axial', 5, dims)).toEqual({ i: 1, j: 2, k: 5 });
    expect(withSliceIndex(v, 'coronal', 50, dims)).toEqual({ i: 1, j: 9, k: 3 });
    expect(withSliceIndex(v, 'sagittal', -1, dims)).toEqual({ i: 0, j: 2, k: 3 });
  });
});

describe('sampleHu: no decoding, never a fake 0', () => {
  const w = 4, h = 3, d = 2;
  it('memory volume: the array value', () => {
    const data = new Float32Array(w * h * d).map((_, n) => n - 100);
    expect(sampleHu({ columns: w, rows: h, slices: d, data }, { i: 1, j: 2, k: 1 }, null)).toBe((1 * h + 2) * w + 1 - 100);
  });
  it('source-backed: only a slice that is already cached; a miss is null (not 0)', () => {
    const metaA = { n: 0 }, metaB = { n: 1 }, plane = new Float32Array(w * h).map((_, n) => n * 10);
    const vol = { columns: w, rows: h, slices: d, sourceBacked: true, data: null, series: { slices: [metaA, metaB] } };
    const cache = new Map([[metaB, plane]]);
    let peeks = 0;
    const peek = m => { peeks++; return cache.get(m) || null; };
    expect(sampleHu(vol, { i: 3, j: 2, k: 1 }, peek)).toBe(110);
    expect(sampleHu(vol, { i: 3, j: 2, k: 0 }, peek)).toBeNull();
    expect(peeks).toBe(2);
    expect(formatHu(null)).toBe('—');
    expect(formatHu(0)).toBe('0');
    expect(formatHu(-424)).toBe('-424');
  });
  it('out of range is null', () => {
    const vol = { columns: w, rows: h, slices: d, data: new Int16Array(w * h * d) };
    for (const v of [{ i: 4, j: 0, k: 0 }, { i: 0, j: 3, k: 0 }, { i: 0, j: 0, k: 2 }, { i: -1, j: 0, k: 0 }]) expect(sampleHu(vol, v, null)).toBeNull();
  });
});

describe('crosshair state API', () => {
  const vol = (c = 16, r = 16, s = 12) => ({ columns: c, rows: r, slices: s, spacing: [0.1, 0.1, 0.2] });
  let events;
  beforeEach(() => {
    setVolume(null); clearCrosshair(); events = [];
  });
  const listen = () => onCrosshairChange(e => events.push(e));

  it('needs a volume; stores integers inside the data; returns copies; JSON round-trips', () => {
    expect(setCrosshair({ i: 1, j: 1, k: 1 })).toBeNull();
    setSourceVolume(vol()); setVolume(vol());
    expect(setCrosshair({ i: 3, j: 5, k: 4 })).toEqual({ i: 3, j: 5, k: 4 });
    expect(setCrosshair({ i: -2, j: 99, k: 4.4 })).toEqual({ i: 0, j: 15, k: 4 });
    const got = getCrosshair(); got.i = 99;
    expect(getCrosshair().i).toBe(0); // a copy
    expect(JSON.parse(JSON.stringify(getCrosshair()))).toEqual(getCrosshair());
    expect(setCrosshair({ i: 'a' })).toBeNull(); // junk is refused and leaves the position
    expect(getCrosshair()).toEqual({ i: 0, j: 15, k: 4 });
  });

  it('notifies on change only; clear notifies once; detail carries the position and the source', () => {
    setSourceVolume(vol()); setVolume(vol());
    const off = listen();
    setCrosshair({ i: 1, j: 2, k: 3 }, 'test'); setCrosshair({ i: 1, j: 2, k: 3 }, 'test');
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ crosshair: { i: 1, j: 2, k: 3 }, previous: null, source: 'test' });
    clearCrosshair(); clearCrosshair();
    expect(events.length).toBe(2);
    expect(events[1].crosshair).toBeNull(); expect(getCrosshair()).toBeNull();
    off(); setCrosshair({ i: 0, j: 0, k: 0 });
    expect(events.length).toBe(2);
  });

  it('a slice slider moves one coordinate; nothing while hidden; setting the same value does not loop', () => {
    setSourceVolume(vol()); setVolume(vol());
    expect(setCrosshairSlice('axial', 5)).toBeNull(); expect(getCrosshair()).toBeNull(); // hidden: a slider alone never creates it
    setCrosshair({ i: 3, j: 5, k: 4 });
    const off = listen();
    setCrosshairSlice('axial', 9); setCrosshairSlice('coronal', 7); setCrosshairSlice('sagittal', 1);
    expect(getCrosshair()).toEqual({ i: 1, j: 7, k: 9 });
    setCrosshairSlice('sagittal', 1);
    expect(events.length).toBe(3);
    off();
  });

  it('switching series clears it; the same size keeps it; a smaller volume of the same series clears it', () => {
    const a = vol(); setSourceVolume(a); setVolume(a);
    setCrosshair({ i: 15, j: 15, k: 11 });
    const filtered = { ...vol() };
    setVolume(filtered); // filters / reset: same size, same series
    expect(getCrosshair()).toEqual({ i: 15, j: 15, k: 11 });
    setVolume(vol(8, 8, 4)); // a different size: an old index would be out of range
    expect(getCrosshair()).toBeNull();
    setVolume(a); setCrosshair({ i: 2, j: 2, k: 2 });
    const b = vol(); setSourceVolume(b); // another series, even of the same size
    expect(getCrosshair()).toBeNull();
    setVolume(b); expect(setCrosshair({ i: 20, j: 20, k: 20 })).toEqual({ i: 15, j: 15, k: 11 }); // clamped
  });

  it('dispatches the DOM event when a document exists', () => {
    const seen = [];
    const doc = new EventTarget();
    globalThis.document = doc;
    try {
      doc.addEventListener('vrl-crosshairchange', e => seen.push(e.detail));
      setSourceVolume(vol()); setVolume(vol());
      setCrosshair({ i: 2, j: 3, k: 4 }, 'dom');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ crosshair: { i: 2, j: 3, k: 4 }, source: 'dom' });
    } finally { delete globalThis.document; }
  });
});

describe('drawing layer', () => {
  const ui = readFileSync('docs/crosshair-ui.js', 'utf8'), shell = readFileSync('docs/ui-shell.js', 'utf8');
  it('lines carry the dark outline of PR #92 (readable in all six themes) and live on their own canvas, not the slice canvas', () => {
    expect(ui).toContain("ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=7;path()");
    expect(ui).toContain("ctx.strokeStyle=COLOR;ctx.lineWidth=3;path()");
    expect(ui).not.toMatch(/planes\[[^\]]+\]\.canvas\.getContext/); // never draws on the .mpr-canvas that theme-image-check compares
    expect(shell).toMatch(/class="mpr-crosshair-canvas"/);
    expect(shell.match(/class="mpr-canvas"/g)).toHaveLength(1); // the template's single slice canvas per plane
  });
});

describe('voxelToLocal3D (3D scene coordinates, same mapping as the 3D MPR planes / section view)', () => {
  // the formulas written out in updateMpr3DPlanePositions (mpr3d-overlay.js) and the cut tools (scene-view.js)
  const ref = (v, dims, [sx, sy, sz]) => {
    const px = dims.columns * sx, py = dims.rows * sy, pz = dims.slices * sz, scale = 3.3 / Math.max(px, py, pz, 1);
    return { x: ((v.i + .5) * sx - px / 2) * scale, y: -((v.j + .5) * sy - py / 2) * scale, z: ((v.k + .5) * sz - pz / 2) * scale };
  };
  it('matches the existing plane-position formulas, including anisotropic spacing', () => {
    for (const [dims, sp] of [[{ columns: 64, rows: 48, slices: 30 }, [0.1, 0.1, 0.5]], [{ columns: 10, rows: 200, slices: 7 }, [0.3, 0.07, 1.2]], [{ columns: 5, rows: 5, slices: 5 }, [1, 1, 1]]]) {
      for (const v of [{ i: 0, j: 0, k: 0 }, { i: 3, j: 4, k: 2 }, { i: dims.columns - 1, j: dims.rows - 1, k: dims.slices - 1 }]) {
        const a = voxelToLocal3D(v, dims, sp), b = ref(v, dims, sp);
        expect(a.x).toBeCloseTo(b.x, 12); expect(a.y).toBeCloseTo(b.y, 12); expect(a.z).toBeCloseTo(b.z, 12);
      }
    }
  });
  it('the centre voxel of an odd grid is the origin; the longest side spans 3.3', () => {
    const dims = { columns: 5, rows: 5, slices: 5 };
    expect(voxelToLocal3D({ i: 2, j: 2, k: 2 }, dims, [1, 1, 1])).toEqual({ x: 0, y: -0, z: 0 });
    const dz = { columns: 4, rows: 4, slices: 10 }, a = voxelToLocal3D({ i: 0, j: 0, k: 0 }, dz, [0.5, 0.5, 1]), b = voxelToLocal3D({ i: 0, j: 0, k: 9 }, dz, [0.5, 0.5, 1]);
    expect(b.z - a.z).toBeCloseTo(3.3 * 9 / 10, 12);
  });
  it('i -> +x, j -> -y (down on screen), k -> +z', () => {
    const dims = { columns: 8, rows: 8, slices: 8 }, o = voxelToLocal3D({ i: 3, j: 3, k: 3 }, dims, [1, 1, 1]);
    const p = voxelToLocal3D({ i: 4, j: 4, k: 4 }, dims, [1, 1, 1]);
    expect(p.x).toBeGreaterThan(o.x); expect(p.y).toBeLessThan(o.y); expect(p.z).toBeGreaterThan(o.z);
  });
});
