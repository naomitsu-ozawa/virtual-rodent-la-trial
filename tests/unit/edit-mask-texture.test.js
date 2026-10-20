import { describe, it, expect, vi } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { editMaskPlanes, editMaskLayout, editMaskInfoWord, fillEditMaskWords, editMaskBit, intervalContains, EDIT_MASK_MAX_BYTES } from '../../docs/edit-mask-texture.js';
import { MedicalVolumeRenderer, volumeShader } from '../../docs/medical-volume.js';

// the desktop volume shader reads edit / applied-cut membership from a voxel bit mask texture instead of
// binary-searching the row's intervals. The bits must be exactly the search's decision for every voxel, every plane count
// (1 / 2 / 4 / 8 bits per voxel) and grid width (partial words at the row end, rows folded into the texture width).

let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = n => Math.floor(rnd() * n);

// sorted, disjoint intervals (touching ones allowed), some reaching x = w - 1, as setEditRuns / setAppliedCutRuns pack them
function randomRows(w, rowCount) {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const list = [];
    if (rnd() < 0.3) { rows.push(list); continue; }
    let x = ri(4);
    while (x < w) {
      const len = 1 + ri(rnd() < 0.2 ? w : 6), x1 = Math.min(w - 1, x + len - 1);
      list.push([x, x1]);
      x = x1 + 1 + (rnd() < 0.2 ? 0 : 1 + ri(8));
    }
    rows.push(list);
  }
  return rows;
}
// offsets: header words, then 4 x (rowCount + 1) row starts (slot s at header + s * (rowCount + 1)); intervals x0 | x1 << 16
function pack(header, perSlot, rowCount, activeMask) {
  const offsets = new Uint32Array(header + 4 * (rowCount + 1)), ints = [];
  offsets[0] = activeMask;
  for (let s = 0; s < 4; s++) {
    const base = header + s * (rowCount + 1);
    for (let r = 0; r < rowCount; r++) { offsets[base + r] = ints.length; for (const [a, b] of perSlot[s]?.[r] || []) ints.push(((b & 65535) << 16) | (a & 65535)); }
    offsets[base + rowCount] = ints.length;
  }
  return { offsets, intervals: new Uint32Array(ints.length ? ints : [0]), activeMask };
}
function randomCase(w, h, d, editActive, cutActive) {
  const rowCount = h * d, edits = [], cuts = [];
  for (let s = 0; s < 4; s++) { edits[s] = editActive & (1 << s) ? randomRows(w, rowCount) : null; cuts[s] = cutActive & (1 << s) ? randomRows(w, rowCount) : null; }
  return { edit: editActive ? pack(2, edits, rowCount, editActive) : null, cut: cutActive ? pack(1, cuts, rowCount, cutActive) : null };
}
function checkAll(w, h, d, edit, cut) {
  const planes = editMaskPlanes(edit?.activeMask || 0, cut?.activeMask || 0), layout = editMaskLayout([w, h, d], planes.count);
  const words = fillEditMaskWords(layout, planes.table, edit, cut);
  let checked = 0, inside = 0;
  for (let s = 0; s < 4; s++) for (const [up, header, k] of [[edit, 2, s], [cut, 1, 4 + s]]) {
    if (!up || !(up.activeMask & (1 << s))) continue;
    const plane = (planes.table >> (3 * k)) & 7, base = header + s * (h * d + 1);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const want = intervalContains(up.offsets, up.intervals, base, z * h + y, x), got = editMaskBit(words, layout, plane, x, y, z);
      if (got !== want) throw new Error(`slot ${s} ${k >= 4 ? 'cut' : 'edit'} plane ${plane} voxel ${x},${y},${z}: mask ${got}, search ${want} (B ${layout.bits}, w ${w})`);
      checked++; if (want) inside++;
    }
  }
  return { checked, inside, layout };
}

describe('edit mask texture packing', () => {
  it('plane table: edit slots in slot order, then the cut slots', () => {
    const { count, table } = editMaskPlanes(0b1010, 0b0101);
    expect(count).toBe(4);
    const entry = k => (table >> (3 * k)) & 7;
    expect([entry(1), entry(3), entry(4), entry(6)]).toEqual([0, 1, 2, 3]);
    expect(editMaskPlanes(0b1111, 0b1111)).toEqual({ count: 8, table: editMaskPlanes(0b1111, 0b1111).table });
    expect(editMaskPlanes(0b1111, 0b1111).table).toBeLessThan(2 ** 24); // exact as an f32 uniform
    expect(editMaskPlanes(0, 0).count).toBe(0);
    expect(editMaskLayout([8, 8, 8], 0)).toBeNull();
  });
  it('bits per voxel follow the plane count; memory at 512³ and 256³', () => {
    const MiB = 1024 * 1024;
    expect([1, 2, 3, 4, 5, 8].map(n => editMaskLayout([512, 512, 512], n).bits)).toEqual([1, 2, 4, 4, 8, 8]);
    expect([1, 2, 4, 8].map(n => editMaskLayout([512, 512, 512], n).bytes / MiB)).toEqual([16, 32, 64, 128]);
    expect([1, 2, 4, 8].map(n => editMaskLayout([256, 256, 256], n).bytes / MiB)).toEqual([2, 4, 8, 16]);
    expect(editMaskLayout([512, 512, 512], 8).bytes).toBeLessThanOrEqual(EDIT_MASK_MAX_BYTES);
    for (const [w, h, d] of [[500, 431, 97], [1, 1, 1], [2048, 2048, 4], [33, 7, 3]]) for (const n of [1, 2, 4, 8]) {
      const L = editMaskLayout([w, h, d], n);
      expect(L.width & (L.width - 1)).toBe(0);
      expect(L.width).toBeGreaterThanOrEqual(Math.max(64, L.wordsPerRow));
      expect(L.bytesPerRow % 256).toBe(0); // copyBufferToTexture row pitch
      expect(L.height).toBeLessThanOrEqual(h); // never taller than the volume texture
      expect(L.width * L.height).toBeGreaterThanOrEqual(h * L.wordsPerRow);
    }
    expect(editMaskInfoWord(editMaskLayout([512, 512, 512], 2))).toBe(2 + 256 * 6);
    expect(editMaskInfoWord(null)).toBe(0);
  });
  it('every bit equals the interval search for random intervals, 1 to 8 planes, odd widths', () => {
    const cases = [
      [37, 5, 3, 0b0001, 0], [64, 4, 2, 0b0011, 0], [100, 3, 3, 0b0101, 0b0010], [33, 6, 2, 0b1111, 0],
      [129, 3, 2, 0b1011, 0b0110], [70, 4, 2, 0b1111, 0b1111], [1, 3, 2, 0b0001, 0b0001], [31, 2, 2, 0, 0b1001],
      [260, 2, 2, 0b0100, 0b1000], [2047, 2, 1, 0b1111, 0b1111],
    ];
    let total = 0;
    for (const [w, h, d, ea, ca] of cases) for (let rep = 0; rep < 3; rep++) {
      const { edit, cut } = randomCase(w, h, d, ea, ca), r = checkAll(w, h, d, edit, cut);
      expect(r.inside).toBeGreaterThan(0);
      expect(r.inside).toBeLessThan(r.checked);
      total += r.checked;
    }
    expect(total).toBeGreaterThan(50000);
  });
  it('an active slot with no interval gives an empty plane; neighbouring planes are untouched', () => {
    const w = 40, h = 3, d = 2, rowCount = h * d, full = Array.from({ length: rowCount }, () => [[0, w - 1]]);
    const edit = pack(2, [null, [], full, null], rowCount, 0b0110), cut = pack(1, [full, null, null, null], rowCount, 0b0001);
    const planes = editMaskPlanes(edit.activeMask, cut.activeMask), layout = editMaskLayout([w, h, d], planes.count), words = fillEditMaskWords(layout, planes.table, edit, cut);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      expect(editMaskBit(words, layout, 0, x, y, z)).toBe(false); // slot 1: active, no interval
      expect(editMaskBit(words, layout, 1, x, y, z)).toBe(true); // slot 2: whole rows
      expect(editMaskBit(words, layout, 2, x, y, z)).toBe(true); // cut slot 0
      expect(editMaskBit(words, layout, 3, x, y, z)).toBe(false); // unused plane of the 4-bit voxel
    }
  });
});

describe('volume shader: the texture lookup mirrors the CPU one', () => {
  const src = volumeShader();
  it('declares binding 12 and parses', () => {
    expect(src).toMatch(/@group\(0\) @binding\(12\) var editMaskTex:texture_3d<u32>;/);
    expect(() => new WgslReflect(src)).not.toThrow();
  });
  it('editMaskBit: word index y * wordsPerRow + (x >> log2 voxels per word), folded by the texture width', () => {
    const fn = src.match(/fn editMaskBit\([\s\S]*?\n}\n/)[0];
    expect(fn).toMatch(/let l=countTrailingZeros\(info&255u\);let lw=info>>8u;let lv=5u-l;/);
    expect(fn).toMatch(/let wpr=\(u32\(u\.textureDims\.x\)\+\(1u<<lv\)-1u\)>>lv;let i=p\.y\*wpr\+\(p\.x>>lv\);/);
    expect(fn).toMatch(/textureLoad\(editMaskTex,vec3<i32>\(i32\(i&\(\(1u<<lw\)-1u\)\),i32\(i>>lw\),i32\(p\.z\)\),0\)\.r/);
    expect(fn).toMatch(/\(\(word>>\(\(\(p\.x&\(\(1u<<lv\)-1u\)\)<<l\)\+plane\)\)&1u\)!=0u/);
  });
  it('edit, pair and cut lookups take the texture only when mprWindow.z is set, else the row search as before', () => {
    const ea = src.match(/fn editAllows\([\s\S]*?\n}\n/)[0], pair = src.match(/fn editInsidePair\([\s\S]*?\n}\n/)[0], cut = src.match(/fn appliedCutContains\([\s\S]*?\n}\n/)[0];
    expect(ea).toMatch(/if\(u\.mprWindow\.z>0\.5\)\{inside=editMaskBit\(editMaskPlane\(seg\),p\);\}else\{/);
    expect(ea).toMatch(/let keep=\(keepMask&\(1u<<seg\)\)!=0u;return select\(!inside,inside,keep\);/);
    expect(pair).toMatch(/if\(u\.mprWindow\.z>0\.5\)\{let pl=editMaskPlane\(seg\);/);
    expect(cut).toMatch(/if\(u\.mprWindow\.z>0\.5\)\{return editMaskBit\(editMaskPlane\(4u\+seg\),p\);\}/);
    for (const f of [ea, pair, cut]) expect(f).toMatch(/loop\{if\(lo>=hi\)\{break;\}/);
  });
});

// a recording WebGPU stand-in: buffers, textures, error scopes
globalThis.GPUBufferUsage ??= { STORAGE: 0x80, COPY_DST: 0x8, COPY_SRC: 0x4, UNIFORM: 0x40 };
globalThis.GPUTextureUsage ??= { TEXTURE_BINDING: 0x4, COPY_DST: 0x2 };
function fakeRenderer(textureDims, { oom = false, limits = {}, bind = false } = {}) {
  const log = { textures: [], uploads: [], groups: [] };
  const device = {
    limits: { maxStorageBufferBindingSize: 1 << 26, maxBufferSize: 1 << 28, maxTextureDimension3D: 2048, ...limits },
    createBuffer: ({ size, mappedAtCreation }) => { const ab = mappedAtCreation ? new ArrayBuffer(size) : null; return { size, ab, getMappedRange: () => ab, unmap: vi.fn(), destroy: vi.fn() }; },
    createTexture: desc => { const t = { desc, destroyed: false }; t.destroy = vi.fn(() => { t.destroyed = true; }); t.createView = () => ({ texture: t }); log.textures.push(t); return t; },
    createBindGroup: desc => { log.groups.push(desc); return desc; },
    createCommandEncoder: () => ({ copyBufferToTexture: (src, dst) => log.uploads.push({ words: new Uint32Array(src.buffer.ab.slice(0)), texture: dst.texture }), finish: () => ({}) }),
    queue: { writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: () => Promise.resolve() },
    pushErrorScope: vi.fn(), popErrorScope: () => Promise.resolve(oom ? { message: 'out of memory' } : null),
  };
  const r = Object.create(MedicalVolumeRenderer.prototype);
  Object.assign(r, { device, textureDims, reducedVolume: false, brickSize: 8, rebuildBindGroup: vi.fn(), editMaskTexture: null, editMaskBuilt: null, editMaskInfo: '', editUpload: null, cutUpload: null });
  if (bind) { // the real rebuildBindGroup over stand-in resources
    delete r.rebuildBindGroup;
    const buf = () => device.createBuffer({ size: 8 });
    Object.assign(r, { texture: { createView: () => ({}) }, brickBuffer: buf(), uniformBuffer: buf(), sampler: {}, pipeline: { getBindGroupLayout: () => ({}) }, previewRowsBuffer: buf(), previewIntervalsBuffer: buf(), analysisOverlayBuffer: buf(), regionTexture: null, onRedraw: vi.fn() });
    r.clearEditRuns(); r.clearAppliedCutRuns();
  }
  return { r, log };
}
const sliceRuns = (d, perSlice) => Array.from({ length: d }, (_, z) => new Uint32Array(perSlice[z] || []));
const ORDER = ['bone', 'soft', 'fat', 'lung'];
const flush = () => new Promise(res => setTimeout(res, 0));

describe('renderer: the mask texture follows setEditRuns', () => {
  const v = { columns: 40, rows: 3, slices: 2 }, dims = [40, 3, 2];
  const edits = () => ({
    bone: { mode: 'exclude', runs: sliceRuns(2, { 0: [1, 3, 9, 1, 20, 39], 1: [0, 0, 0] }), cutRuns: sliceRuns(2, { 1: [2, 5, 6] }) },
    fat: { mode: 'keep', maskOnly: true, runs: sliceRuns(2, { 0: [0, 0, 39], 1: [2, 10, 12] }) },
  });
  it('uploads the bits of what the row buffers hold, and switches the shader to it once the error scope is clean', async () => {
    const { r, log } = fakeRenderer(dims);
    r.setEditRuns(edits(), ORDER, v);
    expect(log.textures).toHaveLength(1);
    expect(r.editMaskUniform()).toEqual([0, 0]); // not before the out-of-memory scope came back
    await flush();
    const [z, table] = r.editMaskUniform(), up = log.uploads[0];
    expect(z).toBe(editMaskInfoWord(r.editMaskBuilt.layout));
    expect(r.editMaskBuilt.layout.bits).toBe(4); // bone edit, fat edit, bone cut: 3 planes
    const L = r.editMaskBuilt.layout, plane = k => (table >> (3 * k)) & 7, rowCount = 6;
    for (let zz = 0; zz < 2; zz++) for (let y = 0; y < 3; y++) for (let x = 0; x < 40; x++) {
      const row = zz * 3 + y;
      expect(editMaskBit(up.words, L, plane(0), x, y, zz)).toBe(intervalContains(r.editUpload.offsets, r.editUpload.intervals, 2, row, x));
      expect(editMaskBit(up.words, L, plane(2), x, y, zz)).toBe(intervalContains(r.editUpload.offsets, r.editUpload.intervals, 2 + 2 * (rowCount + 1), row, x));
      expect(editMaskBit(up.words, L, plane(4), x, y, zz)).toBe(intervalContains(r.cutUpload.offsets, r.cutUpload.intervals, 1, row, x));
    }
    expect(editMaskBit(up.words, L, plane(0), 5, 1, 0)).toBe(true);
    expect(editMaskBit(up.words, L, plane(4), 5, 2, 1)).toBe(true);
  });
  it('a re-sync with the same edits keeps the texture; a changed edit rebuilds it; clearing drops it', async () => {
    const { r, log } = fakeRenderer(dims);
    r.setEditRuns(edits(), ORDER, v); await flush();
    r.setEditRuns(edits(), ORDER, v); await flush();
    expect(log.textures).toHaveLength(1);
    expect(r.editMaskUniform()[0]).toBeGreaterThan(0);
    const changed = edits(); changed.fat.runs = sliceRuns(2, { 0: [0, 0, 38], 1: [2, 10, 12] });
    r.setEditRuns(changed, ORDER, v);
    expect(log.textures).toHaveLength(2);
    expect(log.textures[0].destroy).toHaveBeenCalled();
    await flush();
    expect(r.editMaskUniform()[0]).toBeGreaterThan(0);
    r.setEditRuns({}, ORDER, v);
    expect(r.editMaskTexture).toBeNull();
    expect(r.editMaskUniform()).toEqual([0, 0]);
    expect(log.textures[1].destroy).toHaveBeenCalled();
  });
  it('row buffers replaced elsewhere (clearEditRuns) switch the shader back to the row search', async () => {
    const { r } = fakeRenderer(dims);
    r.setEditRuns(edits(), ORDER, v); await flush();
    expect(r.editMaskUniform()[0]).toBeGreaterThan(0);
    r.editUpload = null; // what clearEditRuns does
    expect(r.editMaskUniform()).toEqual([0, 0]);
  });
  it('an allocation failure or the size cap keeps the row search', async () => {
    const oom = fakeRenderer(dims, { oom: true });
    oom.r.setEditRuns(edits(), ORDER, v); await flush();
    expect(oom.r.editMaskTexture).toBeNull();
    expect(oom.r.editMaskUniform()).toEqual([0, 0]);
    expect(oom.log.textures[0].destroy).toHaveBeenCalled();
    expect(oom.r.editMaskInfo).toMatch(/区間検索/);
    const capped = fakeRenderer(dims, { limits: { maxBufferSize: 256 } });
    capped.r.setEditRuns(edits(), ORDER, v); await flush();
    expect(capped.log.textures).toHaveLength(0);
    expect(capped.r.editMaskUniform()).toEqual([0, 0]);
  });
});

describe('renderer: the bind group never holds a destroyed or unconfirmed mask texture', () => {
  const v = { columns: 40, rows: 3, slices: 2 }, dims = [40, 3, 2];
  const edits = () => ({ bone: { mode: 'exclude', runs: sliceRuns(2, { 0: [1, 3, 9] }), cutRuns: sliceRuns(2, { 1: [2, 5, 6] }) } });
  const mask12 = log => log.groups.at(-1).entries.find(e => e.binding === 12).resource.texture;
  it('binds the dummy until the out-of-memory scope is clean, then the mask texture (and asks for a frame)', async () => {
    const { r, log } = fakeRenderer(dims, { bind: true });
    r.setEditRuns(edits(), ORDER, v);
    const mask = r.editMaskTexture;
    expect(mask).toBeTruthy();
    expect(mask12(log)).not.toBe(mask);
    await flush();
    expect(mask12(log)).toBe(mask);
    expect(r.onRedraw).toHaveBeenCalled();
  });
  it('removing the last edit rebuilds the group without the destroyed texture', async () => {
    const { r, log } = fakeRenderer(dims, { bind: true });
    r.setEditRuns(edits(), ORDER, v); await flush();
    const mask = r.editMaskTexture;
    r.setEditRuns({}, ORDER, v);
    expect(mask.destroyed).toBe(true);
    const t = mask12(log);
    expect(t).not.toBe(mask);
    expect(t.destroyed).toBe(false);
    for (const e of log.groups.at(-1).entries) expect(e.resource?.texture?.destroyed ?? false).toBe(false);
  });
  it('a changed edit swaps the texture: the old one is out of the group before it is destroyed', async () => {
    const { r, log } = fakeRenderer(dims, { bind: true });
    r.setEditRuns(edits(), ORDER, v); await flush();
    const first = r.editMaskTexture, changed = edits(); changed.bone.runs = sliceRuns(2, { 0: [1, 3, 10] });
    r.setEditRuns(changed, ORDER, v);
    expect(first.destroyed).toBe(true);
    expect(mask12(log).destroyed).toBe(false);
    await flush();
    expect(mask12(log)).toBe(r.editMaskTexture);
    expect(r.editMaskTexture).not.toBe(first);
  });
});
