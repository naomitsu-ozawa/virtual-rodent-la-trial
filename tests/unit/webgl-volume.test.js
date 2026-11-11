import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { pickRay, hitBox, texCoordOf } from '../../docs/webgl-volume-pick.js';

installDomStub();
let patchFragmentShader, SHADER_PATCHES, planeState, maskDims, webglVolumeEnabled, fragmentShader, vertexShader, CHILD_SHADER_PATCHES, childItemsOfEntries, childShadeOf, fillChildLut, syncChildListMasks;
beforeAll(async () => {
  ({ patchFragmentShader, SHADER_PATCHES, planeState, maskDims, webglVolumeEnabled, CHILD_SHADER_PATCHES, childItemsOfEntries, childShadeOf, fillChildLut, syncChildListMasks } = await importApp('webgl-volume'));
  ({ fragmentShader, vertexShader } = await importApp('vr-view')); // the VR shader strings (exported for the page's WebGL volume)
});

// The page's WebGL volume (docs/webgl-volume.js) reuses the VR ray-march shader: the strings are exported from vr-view.js and a few page-only additions are patched in.
describe('the VR shader patched for the page', () => {
  it('has every anchor (when vr-view.js changes the text, this says which patch lost its place)', () => {
    for (const p of SHADER_PATCHES) expect(fragmentShader.includes(p.find), 'anchor ' + p.name).toBe(true);
  });
  it('declares the new uniforms once and uses them', () => {
    const out = patchFragmentShader(fragmentShader);
    for (const u of ['capAlpha', 'capHatch', 'capShade', 'planeSlice']) expect(out.split('uniform').filter(x => new RegExp('^\\s+(float|int) ' + u + ';').test(x)).length, u).toBe(1);
    expect(out).toContain('capHatchF(cp,capPlane)');
    expect(out).toContain('capShadeF(cp,ci)');
    expect(out).toContain('((planeSlice>>i)&1)==1');
    expect(out).not.toContain('contribution=(1.0-acc.a)*clamp(segA[ci].z,0.03,1.0);'); // every cap uses the cap opacity
    expect(out.split('capAlpha').length - 1).toBeGreaterThanOrEqual(3);
  });
  it('colours a result\'s surface as the VR volume does (regionLut: its colour x the diffuse light, 0 = hidden), a focused one 18 % brighter', () => {
    const out = patchFragmentShader(fragmentShader);
    expect(out).toContain('uniform highp sampler2D regionLut;'); // the VR shader's own declaration (under VRL_REGIONS) is what regionLit reads
    expect(out).toContain('texelFetch(regionLut,ivec2(i,0),0)');
    expect(out).toContain('e.rgb*diffuse*(((m>>4)&1)==1?1.18:1.0)+vec3(spec)');
    expect(out).not.toContain('regionSeg'); expect(out).not.toContain('regionC['); // the old per-colour tables are gone
    expect(out).not.toContain('vrlC*diffuse+vec3(spec)'); // every surface hit goes through regionLit
    expect(out.split('regionLit(hp+dir').length - 1).toBeGreaterThanOrEqual(3);
  });
  it('leaves the VR shader itself alone (the patched copy is a copy)', () => {
    const before = fragmentShader.length; patchFragmentShader(fragmentShader);
    expect(fragmentShader.length).toBe(before);
    expect(vertexShader).toContain('vPos=position*halfExt');
  });
  it('fails loudly when an anchor is missing', () => {
    expect(() => patchFragmentShader('void main(){}')).toThrow(/anchor/);
  });
});

// Child segments: the shader gets the child additions ONLY for a session with child segments (VRL_CHILDREN); without them the patched text is the one it always was.
describe('child segments in the page volume', () => {
  it('every child anchor exists once, and the child additions are applied only on request', () => {
    const base = patchFragmentShader(fragmentShader);
    for (const p of CHILD_SHADER_PATCHES) expect(base.split(p.find).length - 1, 'anchor ' + p.name).toBe(1);
    expect(patchFragmentShader(fragmentShader, { children: false })).toBe(base); // no child segment: the same text as before
    expect(base).not.toContain('childBase(p,base,s)*diffuse'); expect(base).not.toContain('ctLumAt(cp');
    const kids = patchFragmentShader(fragmentShader, { children: true });
    expect(kids).toContain('return cb*diffuse+vec3(spec);'); expect(kids).toContain('vrlReal(cb,'); expect(kids).toContain('ctLumAt(cp,huAt(texCoord(cp)),s)');
    expect(kids.length).toBeGreaterThan(base.length);
  });
  it('the VR shader has the child block the page relies on (uniforms childTex / childLut, childBase, ctLumAt)', () => {
    for (const t of ['#ifdef VRL_CHILDREN', 'uniform VRL_MP sampler3D childTex;', 'uniform highp sampler2D childLut;', 'vec3 childBase(vec3 p,vec3 base,int s)', 'float ctLumAt(vec3 p,float hu,int s)']) expect(fragmentShader, t).toContain(t);
  });
  it('childItemsOfEntries: only children with a mask, voxels and a parent slot; the slot becomes the mask bit', () => {
    const runs = [[0, 0, 1]];
    const items = childItemsOfEntries([{ key: 'a', runs, voxels: 5, parentSlot: 2, hash: 'h' }, { key: 'b', runs: null, voxels: 5, parentSlot: 0 }, { key: 'c', runs, voxels: 0, parentSlot: 0 }, { key: 'd', runs, voxels: 3, parentSlot: -1 }, { key: 'e', runs, parentSlot: 0 }]);
    expect(items.map(i => [i.key, i.segMask, i.hash])).toEqual([['a', 4, 'h'], ['e', 1, 0]]);
  });
  it('childShadeOf: own range, else the app-resolved one (this frame\'s automatic range wins), else the one handed over, else 0..1', () => {
    expect(childShadeOf({ shade: { lower: 10, upper: 20 }, shadeRange: { lower: 1, upper: 2 } })).toEqual([10, 20]);
    expect(childShadeOf({ shade: null, shadeRange: { lower: 1, upper: 2 } }, { lower: 5, upper: 6 })).toEqual([5, 6]);
    expect(childShadeOf({ shade: null, shadeRange: { lower: 1, upper: 2 } })).toEqual([1, 2]);
    expect(childShadeOf({ shadeRange: { lower: 1, upper: 2 } }, { lower: 7, upper: 7 })).toEqual([1, 2]); // an unusable resolved range falls back
    expect(childShadeOf({}, { lower: 5, upper: 6 })).toEqual([5, 6]);
    expect(childShadeOf({ shade: { lower: 5, upper: 5 } })).toEqual([0, 1]);
  });
  it('syncChildListMasks: a parent whose slot moved changes the prepared list\'s bits (colour / hidden mask follow), the rest stays', () => {
    const list = [{ key: 'a', segMask: 1, hash: 'h' }, { key: 'b', segMask: 2, hash: 'g' }, { key: 'gone', segMask: 4, hash: 'x' }];
    const items = childItemsOfEntries([{ key: 'a', runs: [[0, 0, 1]], voxels: 1, parentSlot: 3, hash: 'h' }, { key: 'b', runs: [[0, 0, 1]], voxels: 1, parentSlot: 1, hash: 'g' }]);
    expect(syncChildListMasks(list, items).map(e => [e.key, e.segMask, e.hash])).toEqual([['a', 8, 'h'], ['b', 2, 'g'], ['gone', 4, 'x']]);
    // the table built from it: the hidden child's mask is its NEW slot bit, a shown child's slot bit moved too
    const a = new Float32Array(256 * 12), R = 1024, rgbOf = () => [1, 1, 1], mats = () => ({ ambient: 0, spec: 0, shininess: 1 });
    fillChildLut(a, list, [{ key: 'a', shown: false }, { key: 'b', shown: true }], rgbOf, mats);
    expect([a[7], a[R + 7], a[11], a[R + 11]]).toEqual([0, 8, 2, 0]); // child 1 = a (hidden: row 0 alpha 0, hidden mask = bit 3), child 2 = b (slot bit 1, not hidden)
  });
  it('fillChildLut = vr-view.js refreshChildLut: colour + slot bit (0 hidden), range / flat / hidden mask, material + opacity', () => {
    const a = new Float32Array(256 * 12), R = 1024, rgbOf = c => [c === 'red' ? 1 : 0, 0.5, 0.25], mats = () => ({ ambient: 0.1, spec: 0.2, shininess: 30 });
    const list = [{ key: 'a', segMask: 2 }, { key: 'b', segMask: 1 }, { key: 'gone', segMask: 1 }];
    fillChildLut(a, list, [{ key: 'a', color: 'red', shown: true, opacity: 0.5, shadeRange: { lower: 100, upper: 400 } }, { key: 'b', color: 'x', shown: false, opacity: 2 }], rgbOf, mats);
    expect([...a.slice(4, 8)]).toEqual([1, 0.5, 0.25, 2]); // child 1: colour, parent slot 1 bit
    expect([...a.slice(R + 4, R + 8)]).toEqual([100, 400, 0, 0]); // range, no flat, not hidden
    expect([...a.slice(2 * R + 4, 2 * R + 8)].map(x => Math.round(x * 1000) / 1000)).toEqual([0.1, 0.2, 30, 0.5]);
    expect(a[8 + 3]).toBe(0); expect(a[R + 8 + 3]).toBe(1); // child 2 hidden: no slot bit in row 0, its hidden mask in row 1
    expect(a[2 * R + 8 + 3]).toBe(1); // opacity clamped
    expect([...a.slice(12, 16)]).toEqual([0, 0, 0, 0]); // a child without an entry has no row
    // the material's kind (skin / muscle / fat = 1..3) rides in row 2's 4th value as opacity + 2 * kind (the shader splits it with floor(w * 0.5)); the plain presets add 0
    const b = new Float32Array(256 * 12);
    globalThis.__vrlSettings = { get: k => (k === 'tissueLook' ? 'gloss' : undefined) }; // the look 艶と断面: kind 3 stays 3 (the default look 標準 draws every preset with kind 0, see lighting.test.js)
    fillChildLut(b, [{ key: 'a', segMask: 1 }], [{ key: 'a', color: 'red', shown: true, opacity: 0.5 }], rgbOf, () => ({ ambient: 0.3, spec: 0.1, shininess: 9, kind: 3 }));
    delete globalThis.__vrlSettings;
    expect(b[2 * R + 7]).toBe(6.5); expect(Math.floor(b[2 * R + 7] * 0.5)).toBe(3); expect(b[2 * R + 7] - 2 * Math.floor(b[2 * R + 7] * 0.5)).toBe(0.5);
  });
});

describe('planeState: the section view and the MPR planes as the shader\'s plane list', () => {
  const dims = [20, 10, 30], half = [1, 0.5, 1.5];
  it('no section, no planes: nothing', () => {
    const s = planeState({}, dims, half);
    expect(s).toMatchObject({ planeCount: 0, planeCut: 0, planeSlice: 0, sliceOpacity: 0, capOn: 0, shade: false });
  });
  it('an axial section: a cutting plane, normal +z, at the slice\'s centre; reverse flips the kept side', () => {
    const mk = reverse => planeState({ indices: [14, 0, 0], visible: [1, 0, 0], opacity: 0.6, section: { active: true, plane: 'axial', index: 14, reverse, capEnabled: true, capOpacity: 0.85, hatch: true } }, dims, half);
    const a = mk(false), b = mk(true);
    expect(a.planeCount).toBe(1); expect(a.planeCut).toBe(1); expect(a.planeSlice).toBe(1);
    const z = ((14 + 0.5) / 30 * 2 - 1) * 1.5;
    expect(a.planes[0]).toEqual([0, 0, 1, z]);
    expect(b.planes[0]).toEqual([0, 0, -1, -z]);
    expect(a).toMatchObject({ capOn: 1, capAlpha: 0.85, capHatch: 1, sliceOpacity: 0.6 });
  });
  it('coronal and sagittal run the other way up (section-view.js sign): kept side is sign*(axis - coord) >= 0', () => {
    const c = planeState({ visible: [0, 1, 0], section: { active: true, plane: 'coronal', index: 3, capEnabled: true } }, dims, half);
    const y = (1 - (3 + 0.5) / 10 * 2) * 0.5;
    expect(c.planes[0]).toEqual([0, -1, 0, -y]);
    const s = planeState({ visible: [0, 0, 1], section: { active: true, plane: 'sagittal', index: 5, reverse: true, capEnabled: true } }, dims, half);
    const x = ((5 + 0.5) / 20 * 2 - 1) * 1;
    expect(s.planes[0]).toEqual([1, 0, 0, x]);
  });
  it('the section\'s slice image hidden: it still cuts and caps, no slice bit', () => {
    const s = planeState({ indices: [0, 0, 0], visible: [0, 0, 0], opacity: 0.6, section: { active: true, plane: 'axial', index: 0, capEnabled: true } }, dims, half);
    expect(s).toMatchObject({ planeCount: 1, planeCut: 1, planeSlice: 0, sliceOpacity: 0, capOn: 1 });
  });
  it('other visible planes are slices that do not cut; their bits are in planeSlice', () => {
    const s = planeState({ indices: [1, 2, 3], visible: [0, 1, 1], opacity: 0.5, section: { active: true, plane: 'axial', index: 1, capEnabled: false } }, dims, half);
    expect(s.planeCount).toBe(3); expect(s.planeCut).toBe(1); expect(s.planeSlice).toBe(0b110);
    expect(s.capOn).toBe(0);
    expect(s.planes[1][1]).not.toBe(0); expect(s.planes[2][0]).not.toBe(0);
  });
  it('MPR planes only: no cut, the slice opacity is the 3D slice opacity', () => {
    const s = planeState({ indices: [5, 5, 5], visible: [1, 1, 1], opacity: 0.4 }, dims, half);
    expect(s).toMatchObject({ planeCount: 3, planeCut: 0, planeSlice: 7, sliceOpacity: 0.4, capOn: 0 });
  });
  it('the cut-face shading is on only with a cap and an active section', () => {
    const on = { on: true, bright: 1.8, contrast: 1.7, ranges: {} };
    expect(planeState({ visible: [0, 0, 0], section: { active: true, plane: 'axial', capEnabled: true, shade: on } }, dims, half).shade).toBe(true);
    expect(planeState({ visible: [0, 0, 0], section: { active: true, plane: 'axial', capEnabled: false, shade: on } }, dims, half).shade).toBe(false);
    expect(planeState({ visible: [0, 0, 0], section: { active: false, plane: 'axial', capEnabled: true, shade: on } }, dims, half).shade).toBe(false);
  });
});

describe('maskDims / the switch', () => {
  it('keeps small grids and caps big ones at 256 per side', () => {
    expect(maskDims([32, 32, 12])).toEqual([32, 32, 12]);
    expect(maskDims([512, 512, 300])).toEqual([256, 256, 150]);
    expect(maskDims([1024, 8, 8])).toEqual([256, 2, 2]);
  });
  it('?webglvolume=0 turns it off, =1 on, the default is on', () => {
    expect(webglVolumeEnabled('')).toBe(true);
    expect(webglVolumeEnabled('?webglvolume=0')).toBe(false);
    expect(webglVolumeEnabled('?a=1&webglvolume=1')).toBe(true);
  });
});

// ---- the CPU pick: a port of the WebGPU compute pick ----
function volumeOf(dims, huOf, { signed = true } = {}) {
  const [w, h, d] = dims, data = new Uint8Array(w * h * d * 2), bias = signed ? 32768 : 0;
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = huOf(x, y, z) + bias, o = ((z * h + y) * w + x) * 2; data[o] = u & 255; data[o + 1] = u >> 8; }
  return { data, calibration: [1, 0, bias] };
}
describe('pickRay (the voxel under a ray)', () => {
  const dims = [16, 16, 16], half = [1, 1, 1], step = 2 / 16 * 0.85;
  const segs = [{ min: 300, max: 5000, enabled: true }, { min: -50, max: 200, enabled: true }, { min: 0, max: 0, enabled: false }, { min: 0, max: 0, enabled: false }];
  // a cube of 1200 (x 4..11, y 4..11, z 4..11) in air
  const cube = volumeOf(dims, (x, y, z) => (x >= 4 && x <= 11 && y >= 4 && y <= 11 && z >= 4 && z <= 11 ? 1200 : -1000));
  const common = { ...cube, dims, halfExt: half, step, segs };
  it('a ray from +z straight down the middle hits the cube\'s +z face (bone, slot 0)', () => {
    const hit = pickRay({ ...common, origin: [0.03, 0.03, 3], dir: [0, 0, -1] });
    expect(hit).toMatchObject({ slot: 0, z: 11 });
    expect(hit.x).toBe(8); expect(hit.y).toBe(7); // y runs down the rows: +0.03 up is row 7
  });
  it('the texture coordinates are x/2h + .5, .5 - y/2h, z/2h + .5', () => {
    expect(texCoordOf([0.5, 0.5, -0.5], [1, 1, 1])).toEqual([0.75, 0.25, 0.25]);
  });
  it('a ray that misses the box, or only crosses air, is null', () => {
    expect(pickRay({ ...common, origin: [3, 3, 3], dir: [0, 0, -1] })).toBeNull();
    expect(pickRay({ ...common, origin: [0.95, 0.95, 3], dir: [0, 0, -1] })).toBeNull();
  });
  it('a disabled segment is not hit; a preferred slot only matches itself', () => {
    const off = segs.map(s => ({ ...s, enabled: false }));
    expect(pickRay({ ...common, segs: off, origin: [0, 0, 3], dir: [0, 0, -1] })).toBeNull();
    expect(pickRay({ ...common, preferred: 1, origin: [0, 0, 3], dir: [0, 0, -1] })).toBeNull();
    expect(pickRay({ ...common, preferred: 0, origin: [0, 0, 3], dir: [0, 0, -1] })).toMatchObject({ slot: 0 });
  });
  it('an exclusion mask removes voxels: the ray goes through the excluded part and hits what is behind', () => {
    // mask on the 16^3 grid: slot 0 excluded where z >= 8, allowed elsewhere (RGBA8, channel = slot)
    const em = new Uint8Array(16 * 16 * 16 * 4);
    for (let z = 0; z < 16; z++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) em[((z * 16 + y) * 16 + x) * 4] = z >= 8 ? 0 : 255;
    const hit = pickRay({ ...common, edit: { activeMask: 1, maskOnly: 0, data: em, dims: [16, 16, 16] }, origin: [0, 0, 3], dir: [0, 0, -1] });
    expect(hit).toMatchObject({ slot: 0 }); expect(hit.z).toBe(7);
  });
  it('a mask-only segment is decided by its mask alone (voxels outside its HU range count)', () => {
    const em = new Uint8Array(16 * 16 * 16 * 4);
    for (let i = 0; i < 16 * 16 * 16; i++) em[i * 4 + 1] = 255;
    const air = volumeOf(dims, () => -1000);
    const hit = pickRay({ ...air, dims, halfExt: half, step, segs, edit: { activeMask: 2, maskOnly: 2, data: em, dims }, preferred: 1, origin: [0, 0, 3], dir: [0, 0, -1] });
    expect(hit).toMatchObject({ slot: 1, z: 15 });
  });
  it('a reduced texture: the voxel comes back in the source grid', () => {
    const hit = pickRay({ ...common, srcDims: [32, 32, 32], origin: [0.03, 0.03, 3], dir: [0, 0, -1] });
    expect(hit.z).toBeGreaterThan(11); expect(hit.z).toBeLessThanOrEqual(31);
  });
  it('hitBox: the entry and exit of the ray', () => {
    const [a, b] = hitBox([0, 0, 3], [0, 0, -1], [1, 1, 1]);
    expect(a).toBeCloseTo(2); expect(b).toBeCloseTo(4);
  });
});

// A device WITH WebGPU must load exactly what it loaded before the WebGL volume existed: nothing of it is reached from the page's start-up imports. The only route to it is vr-view.js (re-export), which
// app.js already loads lazily (the 'vrl-vr-module' import()); webgl-volume.js has no import() of its own (no new dynamic-import site).
describe('start-up loading of a device with WebGPU', () => {
  const docs = new URL('../../docs/', import.meta.url), text = f => readFileSync(new URL(f, docs), 'utf8');
  const files = readdirSync(docs).filter(f => f.endsWith('.js'));
  const importers = name => files.filter(f => new RegExp("(?:from|import)\\s*['\"]\\./" + name.replace('.', '\\.') + "[?']").test(text(f)));
  it('webgl-volume.js is imported by vr-view.js only (a re-export), never by app.js or any start-up module', () => {
    expect(importers('webgl-volume.js')).toEqual(['vr-view.js']);
    expect(text('app.js')).not.toMatch(/['"]\.\/webgl-volume/);
  });
  it('webgl-volume-pick.js is reached only through webgl-volume.js', () => {
    expect(importers('webgl-volume-pick.js')).toEqual(['webgl-volume.js']);
  });
  it('webgl-volume.js has no import() of its own; app.js gets the classes from the module its existing lazy load returns', () => {
    expect(text('webgl-volume.js')).not.toMatch(/\bimport\s*\(/);
    expect(text('vr-view.js')).toMatch(/export \{ WebGlVolumeRenderer, webglVolumeEnabled \} from '\.\/webgl-volume\.js/);
    const app = text('app.js');
    expect(app).toMatch(/dispatchEvent\(ev\);const vrMod=await ev\.detail\.done;if\(vrMod\.webglVolumeEnabled\(\)\)/);
    expect((app.match(/import\('\.\/vr-view\.js/g) || []).length).toBe(1); // the one existing site
  });
  it('the WebGL volume is only asked for when there is no WebGPU renderer', () => {
    expect(text('app.js')).toMatch(/if\(backend!=='WEBGPU'\)try\{const ev=new CustomEvent\('vrl-vr-module'/);
  });
});
