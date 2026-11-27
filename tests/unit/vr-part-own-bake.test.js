// A detached part drawn by the ORDINARY program on its own baked bytes (docs/vr-part-view.js partBakeOwn + partBakeAlpha fresh, driven by vr-view.js pbFrame / pbBind / partRender).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partBakeOwn, partBakeRun, partSetWorkerSource } from '../../docs/vr-part-view.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

// 8^3 grid (index grid = combined grid), the part's field in a 4^3 box at 2..5 (one channel), slot 0 on channel 0, slot 1 on channel 1
const job = (fieldValue, a0) => {
  const dims = [8, 8, 8], n = 512, rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 3] = 0; }
  const a = [[a0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [[0, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; // slot 1: a = b = 0, not the part's
  return { own: true, rgba, c4: null, box: { lo: [0, 0, 0], size: dims }, cdims: dims, idims: dims, chan: [0, 1, -1, -1], body: { data: new Uint8Array(64).fill(fieldValue), lo: [2, 2, 2], size: [4, 4, 4], C: 1, a, b }, mask: 3, hide: null };
};
const at = (x, y, z) => (x + 8 * (y + 8 * z)) * 4;

describe('partBakeOwn: the part is tissue where its field is >= 0.5', () => {
  it('keeps the byte where the field is 1, takes min(byte, field) inside the box, zeroes outside the box and every slot that is not the part\'s', () => {
    const j = job(255, 1), r = partBakeOwn(j);
    expect(r.slots).toBe(3);
    expect(j.rgba[at(3, 3, 3)]).toBe(255);
    expect(j.rgba[at(0, 0, 0)]).toBe(0); // outside the field's box
    expect(j.rgba[at(7, 3, 3)]).toBe(0);
    expect(j.rgba[at(3, 3, 3) + 1]).toBe(0); // slot 1: a = b = 0
    const k = job(100, 1); partBakeOwn(k);
    expect(k.rgba[at(3, 3, 3)]).toBe(100); // min(255, round(255 * 100 / 255))
    const lo = job(100, 1); lo.rgba[at(3, 3, 3)] = 40; partBakeOwn(lo);
    expect(lo.rgba[at(3, 3, 3)]).toBe(40); // never above the original byte
  });
  it('the cut sits on the field\'s 0.5 level: a byte below 128 exactly where the field is below 0.5', () => {
    const lo = partBakeOwn(job(127, 1)), j = job(127, 1); partBakeOwn(j);
    expect(lo.slots).toBe(3);
    expect(j.rgba[at(3, 3, 3)]).toBeLessThan(128);
    const k = job(128, 1); partBakeOwn(k);
    expect(k.rgba[at(3, 3, 3)]).toBeGreaterThanOrEqual(128);
  });
  it('a stored fourth channel is only baked when its own bytes are given', () => {
    const j = job(255, 1); j.chan = [0, 1, -1, 3]; j.mask = 9; expect(partBakeOwn(j).slots).toBe(1);
    const k = job(255, 1); k.chan = [0, 1, -1, 3]; k.mask = 9; k.c4 = new Uint8Array(512).fill(255); expect(partBakeOwn(k).slots).toBe(9);
    expect(k.c4[3 + 8 * (3 + 8 * 3)]).toBe(0); // slot 3 has no field here (a = b = 0)
  });
});

describe('partBakeRun on a part\'s own bytes', () => {
  it('writes the new distance alpha itself (not the minimum with the old one), capped by the box faces', () => {
    const j = job(255, 1); j.mask = 1; const r = partBakeRun(j);
    expect(r.slots).toBe(1);
    expect(r.alphaLowered).toBe(512); // every alpha byte of the box is written
    expect(j.rgba[at(0, 0, 0) + 3]).toBe(0); // a face voxel: no jump
    expect(j.rgba[at(3, 3, 3) + 3]).toBeLessThanOrEqual(3); // inside the 4^3 block: the distance to its surface, in voxels
    const old = job(255, 1); old.mask = 1; for (let i = 0; i < 512; i++) old.rgba[i * 4 + 3] = 7; partBakeRun(old);
    expect(Math.max(...Array.from({ length: 512 }, (_, i) => old.rgba[i * 4 + 3]))).toBeLessThan(255);
  });
  it('the worker has the function', () => {
    expect(partSetWorkerSource()).toContain('function partBakeOwn(');
  });
});

describe('vr-view.js: the wiring of the parts\' own bake', () => {
  it('a bound, current bake is drawn by the ordinary program of the body\'s set, anything else by the part\'s VRL_PART programs', () => {
    const r = src.slice(src.indexOf('partRender=low=>{'), src.indexOf('// the tables (called from refreshRegionLut'));
    expect(r).toContain('const nb=nOk&&q.nmats&&q.pb&&q.pb.bound&&q.pb.bkey===q.bkey;');
    expect(r).toContain('q.rayMesh.material=nb?q.nmats.rays[kn]:q.mats.rays[k]');
    expect(r).toContain('else q.mesh.material=nb?q.nmats.vars[kn]:q.mats.vars[k];');
    expect(r).toContain("msets.get(setKey)?.compiled.has(kn)");
  });
  it('the ordinary programs have no VRL_PART define and read the part\'s own uniforms (its baked bytes, its own hidden flags, hideVMode 0, the light with the normal flipped)', () => {
    const nu = src.slice(src.indexOf('const partNuOf='), src.indexOf('const pbUnbind='));
    for (const k of ['clsTex:{value:u.clsTex.value}', 'cls4Tex:', 'hideVMode:{value:0}', 'regionAnyHidden:{value:1}', 'childAnyHidden:{value:1}', 'bakeCut:{value:0}', 'bakeField:{value:null}']) expect(nu).toContain(k);
    const bind = src.slice(src.indexOf('const pbBind='), src.indexOf('const pbFrame='));
    expect(bind).toContain('makeVolumeBase(definesOfKey(setKey),nu)');
    expect(bind).not.toContain('VRL_PART');
    expect(bind).toContain('nu.bakeCut.value=(b.cut&15)|16;');
  });
  it('every state that changes what it was made from drops it at once; one part is made at a time, over a budget it waits', () => {
    const f = src.slice(src.indexOf('const pbFrame='), src.indexOf('partBakeFrame=()=>{bodyBakeFrame();pbFrame()}'));
    expect(f).toContain('!ok||q.freed||b.src!==t.combo||cm!==b.mask||b.bkey!==q.bkey');
    expect(f).toContain('bakeApplying>0');
    expect(f).toContain('parts.find(q=>q.pb&&!q.pb.ready)');
    const ok = src.slice(src.indexOf('const pbOk='), src.indexOf('const pbStart='));
    for (const c of ['diagAn.noRegion', 'u.distInCls.value>0', 'u.useCls.value>0', '!t.rb?.busy', 't.comboMask===comboMask', '!ui.swapBusy']) expect(ok).toContain(c);
    expect(src).not.toContain('PART_BAKE_BYTES_MAX');
    expect(src.slice(src.indexOf('const pbStart='), src.indexOf('const pbBind='))).toContain('(four&&!four4)'); // never the whole body's fourth segment inside a part
    expect(src).toContain('partBakeDrop=()=>{bakeDrop();for(const q of parts)q.pb&&pbDrop(q)}');
    expect(src).toContain('const partFree=q=>{partHide(q);q.held=null;pbDrop(q);');
  });
  it('the part\'s own hidden flags follow its own tables', () => {
    expect(src).toContain('q.nu.regionAnyHidden.value=anyHiddenIn(q.lutOwnR.image.data,regionList.length)');
    expect(src).toContain('q.nu.childAnyHidden.value=bakeChildAnyHidden(q.lutOwnC.image.data,childList.length)');
  });
});
