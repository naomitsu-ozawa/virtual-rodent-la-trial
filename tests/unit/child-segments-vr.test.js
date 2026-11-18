import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { shaderTemplate, preprocess } from '../helpers/glsl-preprocess.js';
import { labelAt } from '../../docs/vr-label-histogram.js';
import { classifiedAt, marchClassificationHitInfo } from '../../docs/vr-pick.js';
import { pointIsHidden } from '../../docs/vr-point.js';
import { buildChildIndexOf, buildRegionIndexOf, prepWorkerSource, prepRun } from '../../docs/vr-volume-prep.js';

// VR child segments: their own index (never the results' ids), the shader's compile-time separation, and the anchors the no-WebGPU branch patches.
const dims = [20, 16, 12];
const box = (x0, x1, y0 = 0, y1 = 15) => { const runs = Array.from({ length: dims[2] }, () => []); for (let z = 0; z < dims[2]; z++) for (let y = y0; y <= y1; y++) runs[z].push(y, x0, x1); return runs; };
const kid = (key, runs, segMask = 1) => ({ key, segMask, runsBySlice: runs });
const at = (r, x, y = 0, z = 0) => r.ids[x + dims[0] * (y + dims[1] * z)];

describe('buildChildIndexOf', () => {
  it('no items -> null (a session without child segments prepares nothing)', () => {
    expect(buildChildIndexOf([], dims, dims)).toBeNull();
    expect(buildChildIndexOf(undefined, dims, dims)).toBeNull();
  });
  it('ids 1..N per voxel in their own texture, a later child wins where two overlap, the list carries key and slot bits', () => {
    const r = buildChildIndexOf([kid('s1', box(0, 9)), kid('s2', box(8, 14), 2)], dims, dims);
    expect(r.list).toEqual([{ key: 's1', segMask: 1, hash: '' }, { key: 's2', segMask: 2, hash: '' }]);
    expect(at(r, 3)).toBe(1); expect(at(r, 8)).toBe(2); expect(at(r, 12)).toBe(2); expect(at(r, 17)).toBe(0);
  });
  it('at most 255 children; the rest is counted in `dropped` (the caller warns, never silent)', () => {
    const many = Array.from({ length: 260 }, (_, i) => kid('s' + i, box(0, 1)));
    const r = buildChildIndexOf(many, dims, dims); expect(r.list).toHaveLength(255); expect(r.dropped).toBe(5);
    expect(buildChildIndexOf([kid('s1', box(0, 1))], dims, dims).dropped).toBe(0);
  });
  it('a reduced grid (the source is larger than the texture) dilates the mask by one voxel; the same grid does not', () => {
    const src = [40, 32, 24], runsSrc = Array.from({ length: src[2] }, () => []); for (let z = 0; z < src[2]; z++) for (let y = 0; y < src[1]; y++) runsSrc[z].push(y, 10, 21); // x 10..21 of 40 = texture x 5..10 of 20
    const same = buildChildIndexOf([kid('s1', box(5, 10))], dims, dims), red = buildChildIndexOf([{ key: 's1', segMask: 1, runsBySlice: runsSrc }], src, dims);
    let a = 0, b = 0; for (let i = 0; i < same.ids.length; i++) { if (same.ids[i]) a++; if (red.ids[i]) b++; }
    expect(a).toBe(6 * dims[1] * dims[2]); // no dilation on the same grid
    expect(b).toBeGreaterThan(a); // the reduced grid's child covers the voxels it only touches
    expect(red.ids[4 + dims[0] * (3 + dims[1] * 3)]).toBe(1); expect(red.ids[11 + dims[0] * (3 + dims[1] * 3)]).toBe(1);
  });
  it('does not touch the results index: buildRegionIndexOf is the 704 function (no child item, no `children` field)', () => {
    const regs = [{ color: 0xff0000, segMask: 1, runsBySlice: box(0, 5), mm3: 1, segmentKeys: ['bone'], rid: 'a' }];
    const r = buildRegionIndexOf(regs, dims, dims);
    expect('children' in r).toBe(false); expect(r.list).toHaveLength(1);
  });
  it('is part of the worker source, and the worker job returns it only when there are child items', () => {
    expect(prepWorkerSource()).toContain('buildChildIndexOf');
    const sent = []; const n = dims[0] * dims[1] * dims[2];
    const base = { t: 'cls', id: 1, src: new Uint8Array(n * 2).buffer, dims, calib: [1, -1024, 0], editDescs: [], editSourceDims: dims, regionItems: [], order: ['bone', 'soft', 'fat', 'lung'], state: {}, brickDimsFull: [3, 2, 2], brickDimsHalf: null, mask: -1 };
    prepRun({ ...base }, m => sent.push(m)); expect(sent[0].child).toBeUndefined();
    sent.length = 0; prepRun({ ...base, src: new Uint8Array(n * 2).buffer, childItems: [kid('s1', box(2, 4))] }, m => sent.push(m));
    expect(sent[0].child?.list).toEqual([{ key: 's1', segMask: 1, hash: '' }]); expect(sent[0].child.rg.length).toBe(2 * n); expect(sent[0].child.ids).toBeUndefined(); // an earlier change: the one RG array (packIndexRg)
  });
});

describe('the VR shader keeps child segments out of every session without them', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('every #ifdef VRL_CHILDREN block is closed; the child programs are only compiled with the define', () => {
    let stack = [], bad = 0;
    for (const l of src.split('\n')) { if (/^#if/.test(l)) stack.push(l); else if (/^#endif/.test(l) && !stack.pop()) bad++; }
    expect(bad).toBe(0); expect(stack).toEqual([]);
    expect(src).toContain("...(children?{VRL_CHILDREN:''}:{})");
  });
  it('the existing anchors of the no-WebGPU branch are unchanged (the child code is in new delimited blocks)', () => {
    for (const a of [
      'VRL_MP vec3 lit=regionColor(hp+dir*(0.75*voxelMin),segC[idx].rgb,idx)*diffuse+vec3(spec);',
      'VRL_MP vec3 lit=vrlRealCut(mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22),n,viewDir,vLightOff,vrlDepth01(capAt,o,halfExt));', // the cut face: every segment with the cut look
      'clamp(segA[ci].z,0.03,1.0)', 'uniform int capOn;', 'void main(){\n gl_FragDepth=gl_FragCoord.z;', 'float ctLumHU(float hu,int s){',
      'vec3 regionColor(vec3 p,vec3 base,int s){\n int i=int(texture(regionTex,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).r*255.0+0.5);',
      'vec4 e=texelFetch(regionLut,ivec2(i,0),0);', 'uniform highp sampler2D regionLut;',
    ]) expect(src, a).toContain(a);
    for (const b of ['block A:', 'block A2', 'block B:']) expect(src, b).toContain('CHILD SEGMENTS, ' + b);
  });
  it('the results texture and table are the 704 ones: 256 x 1, no child row', () => {
    expect(src).toContain('const regionLut=new THREE.DataTexture(new Float32Array(256*4),256,1,THREE.RGBAFormat,THREE.FloatType)');
  });
  it('APP SPEED: without child segments the shader text is the one of, for every program the app compiles (24 define sets: variants x fp16 x results x four segments)', () => {
    // the hash of the 704 shader (docs/vr-view.js of the previous build) after the conditional compilation pass: the child code (VRL_CHILDREN) is compiled out, so a session without child segments
    // draws with exactly the programs it always had. If this fails the shader text of a child-free session changed: justify it, or move the change under VRL_CHILDREN.
    const t = shaderTemplate(src), V = [[], ['VRL_NO_GENERAL', 'VRL_OPAQUE'], ['VRL_NO_GENERAL', 'VRL_NO_EVENTS', 'VRL_OPAQUE']], h = createHash('sha256');
    for (const med of [0, 1]) for (const reg of [0, 1]) for (const cls4 of [0, 1]) for (const v of V) h.update(preprocess(t, new Set([...v, ...(med ? ['VRL_MEDIUMP'] : []), ...(reg ? ['VRL_REGIONS'] : []), ...(cls4 ? ['VRL_CLS4'] : [])])) + '\n--\n');
    expect(h.digest('hex').slice(0, 24)).toBe('8410194a04eae6ee1f6e6dd0'); // n740: the light of a baked cut (vr-view.js VRL_BAKE_CUT: bakeGrad, read only where the uniform bakeCut has the hit's slot) in the VRL_NO_GENERAL programs WITH results, the programs a baked body is drawn with; bakeCut 0 never takes the branch, so a picture without a baked cut is the one before. Before: 15ca0202cb710d5b332f8c1d. n736: the 8-voxel cell read for hidden debris (7977efc35: hideSegAirAt / hideCellAt / hideSkinAt) removed from the programs WITH results; before: ab1d7b560ea8325168c51a3b. n731 fix2: gradientAtS (the mask-field normal, vr-view.js) is now in EVERY program, not only with VRL_CHILDREN: the programs of a session without child segments changed on purpose. Before: 115fdd59a34ed168fb34cd1f. // view-perf (n730): every program changed on purpose, one line: jkA is written 0.5 * length(dir * texDims / halfExt) (the same number: exact powers of two) so that no 2.0 * halfExt is made before the march (the compiler kept it live through the loop, shared with the shading after it); the same pixels (tools/vr-render-golden.mjs). Before: ef2ff567c952e0a4f14dfc57, an earlier change. Before: 4118df49caf6097f34ce5eee. Earlier: an earlier change. Before: 9ddc41bbce3e35a17ed2c2d5. Earlier: an earlier change: the programs WITH results changed again: the three see-through hit searches after a hidden part also count the air cell beside it as hidden (hideCellAt, the same one function, called three more times; the programs without results are unchanged: df8513fadf401e88acda8d31). Before: 5ba64386bae5f4d4f53c2bdf. Earlier: an earlier change: the programs WITH results changed again: at the candidate hit of the three loops, a hide index 0 voxel that is air looks at the 8 voxels of the trilinear cell (hideCellAt, ONE function for results and children, called only there and only while something is hidden; regionHiddenAt / childHiddenAt are the ones of 06857df). Before: 94771b3e21e6b7f0e909f963 (the cell test inside regionHiddenAt / childHiddenAt: compiled twice as slowly), the programs without results are unchanged (df8513fadf401e88acda8d31). Before: a3fec59290a59ee420a06ab3, an earlier change (review 1): the see-through programs WITH results changed again: no distance-field jump inside the segment the ray is in while something is hidden (hideAnyOn); the opaque ones and the ones without results are unchanged. Before: 38489677902097d63e0703c5, an earlier change (the review's follow-up: an inner item keeps its shape, see-through hidden parts): the programs WITH results changed again on purpose, all under VRL_HIDE and read only while something is hidden (hideAnyOn): the first-sample test once per ray before the loops (was in each loop), a hidden part inside the segment a see-through ray is in (lastIndex -1), the uniform-brick skip off while something is hidden; the programs without results are unchanged (df8513fadf401e88acda8d31 before and after). Before: 6c26e03ec08645e7a71eae0a, an earlier change: the programs WITH results changed on purpose, all of it under VRL_HIDE / read only on a ray that passed a hidden part (prevHid) or whose first sample is in one, or where the colour index's result is hidden (regionColor: the hide index's result): no distance-field jump from a hidden sample, the hit after it searched as "in the segment and not hidden" (hideAt) and lit by the hidden part's border (hideGrad), the hidden tests read the index texture's G channel (the hide index). Before: 8df122bbe60f9065c4e78846, an earlier change (the 色 / 表示 follow-up): the programs WITH results (VRL_REGIONS) changed again on purpose: the uniform regionAnyHidden (declared and read only under VRL_REGIONS) gates every regionHiddenAt read; the programs without results are as before. Earlier, an earlier change stage 2: the programs WITH results (VRL_REGIONS) changed on purpose: a hidden result is no hit / no cut face / no slice tint (regionHiddenAt / regionVis, sliceColorR, the loops' passH under VRL_HIDE); the ones without results are unchanged (the next test). Before: 058d2ba6624a57df951346b8, (after): 質感の色味 and skin / muscle / fat removed: the surface hit is the plain model again (the text of before: no vrlReal, no kind chain), every cut face calls vrlRealCut (lighting.js CUT_REAL, the muscle values; it replaces the plain cap's vrlShade), sliceLook keeps its gate (vrlRealCut has no material argument). Before: tissue look setting (9 kinds in the one vrlReal chain, the cut-face look for kinds 1..3 only: w < 3.5); before it: gloss trial (cut face / slice of skin / muscle / fat lit like the surface): sliceLook (a branch on segM[si].w, runs only at a slice or cap pixel, not per ray or sample), sliceColor takes the ray (rd, ro), the cap line adds vrlRealCut; vrlRealG / vrlRealCut are new helpers in lighting.js (no per-pixel cost when unused).: the lit line names the colour (vrlC) and the hit's normal / depth / keep (vrlN / vrlD / vrlK); skin / muscle / fat add vrlReal (a branch on segM[idx].w, 0 for the plain presets) Before the stripe merge (1224407a4d71197a7f889078): integration (pair-perf Q + hideFieldOk): (fewer march steps while a result / child is hidden): the programs WITH results changed: the uniform hideVMode and hideFieldOk() (VRL_PART: false) are declared under VRL_HIDE, and the three combined-field jump tests read `prevHid&&!hideFieldOk()` instead of `prevHid`; the programs without results are unchanged (df8513fadf401e88acda8d31). Before: 5ba64386bae5f4d4f53c2bdf, an earlier change: the programs WITH results changed again: at the candidate hit of the three loops, a hide index 0 voxel that is air looks at the 8 voxels of the trilinear cell (hideCellAt, ONE function for results and children, called only there and only while something is hidden; regionHiddenAt / childHiddenAt are the ones of 06857df). Before: 94771b3e21e6b7f0e909f963 (the cell test inside regionHiddenAt / childHiddenAt: compiled twice as slowly), the programs without results are unchanged (df8513fadf401e88acda8d31). Before: a3fec59290a59ee420a06ab3, an earlier change (review 1): the see-through programs WITH results changed again: no distance-field jump inside the segment the ray is in while something is hidden (hideAnyOn); the opaque ones and the ones without results are unchanged. Before: 38489677902097d63e0703c5, an earlier change (the review's follow-up: an inner item keeps its shape, see-through hidden parts): the programs WITH results changed again on purpose, all under VRL_HIDE and read only while something is hidden (hideAnyOn): the first-sample test once per ray before the loops (was in each loop), a hidden part inside the segment a see-through ray is in (lastIndex -1), the uniform-brick skip off while something is hidden; the programs without results are unchanged (df8513fadf401e88acda8d31 before and after). Before: 6c26e03ec08645e7a71eae0a, an earlier change: the programs WITH results changed on purpose, all of it under VRL_HIDE / read only on a ray that passed a hidden part (prevHid) or whose first sample is in one, or where the colour index's result is hidden (regionColor: the hide index's result): no distance-field jump from a hidden sample, the hit after it searched as "in the segment and not hidden" (hideAt) and lit by the hidden part's border (hideGrad), the hidden tests read the index texture's G channel (the hide index). Before: 8df122bbe60f9065c4e78846, an earlier change (the 色 / 表示 follow-up): the programs WITH results (VRL_REGIONS) changed again on purpose: the uniform regionAnyHidden (declared and read only under VRL_REGIONS) gates every regionHiddenAt read; the programs without results are as before. Earlier, an earlier change stage 2: the programs WITH results (VRL_REGIONS) changed on purpose: a hidden result is no hit / no cut face / no slice tint (regionHiddenAt / regionVis, sliceColorR, the loops' passH under VRL_HIDE); the ones without results are unchanged (the next test). Before: 058d2ba6624a57df951346b8, (after): 質感の色味 and skin / muscle / fat removed: the surface hit is the plain model again (the text of before: no vrlReal, no kind chain), every cut face calls vrlRealCut (lighting.js CUT_REAL, the muscle values; it replaces the plain cap's vrlShade), sliceLook keeps its gate (vrlRealCut has no material argument). Before: tissue look setting (9 kinds in the one vrlReal chain, the cut-face look for kinds 1..3 only: w < 3.5); before it: gloss trial (cut face / slice of skin / muscle / fat lit like the surface): sliceLook (a branch on segM[si].w, runs only at a slice or cap pixel, not per ray or sample), sliceColor takes the ray (rd, ro), the cap line adds vrlRealCut; vrlRealG / vrlRealCut are new helpers in lighting.js (no per-pixel cost when unused).: the lit line names the colour (vrlC) and the hit's normal / depth / keep (vrlN / vrlD / vrlK); skin / muscle / fat add vrlReal (a branch on segM[idx].w, 0 for the plain presets) ALSO, from pair-perf: pair-perf: every program changed on purpose: the distance-field jumps are (dd - margin) grid-index units along the ray (jkA), rounded down to whole steps (Q), in all four jump sites; nothing else. Before: 5ba64386bae5f4d4f53c2bdf, an earlier change: the programs WITH results changed again: at the candidate hit of the three loops, a hide index 0 voxel that is air looks at the 8 voxels of the trilinear cell (hideCellAt, ONE function for results and children, called only there and only while something is hidden; regionHiddenAt / childHiddenAt are the ones of 06857df). Before: 94771b3e21e6b7f0e909f963 (the cell test inside regionHiddenAt / childHiddenAt: compiled twice as slowly), the programs without results are unchanged (df8513fadf401e88acda8d31). Before: a3fec59290a59ee420a06ab3, an earlier change (review 1): the see-through programs WITH results changed again: no distance-field jump inside the segment the ray is in while something is hidden (hideAnyOn); the opaque ones and the ones without results are unchanged. Before: 38489677902097d63e0703c5, an earlier change (the review's follow-up: an inner item keeps its shape, see-through hidden parts): the programs WITH results changed again on purpose, all under VRL_HIDE and read only while something is hidden (hideAnyOn): the first-sample test once per ray before the loops (was in each loop), a hidden part inside the segment a see-through ray is in (lastIndex -1), the uniform-brick skip off while something is hidden; the programs without results are unchanged (df8513fadf401e88acda8d31 before and after). Before: 6c26e03ec08645e7a71eae0a, an earlier change: the programs WITH results changed on purpose, all of it under VRL_HIDE / read only on a ray that passed a hidden part (prevHid) or whose first sample is in one, or where the colour index's result is hidden (regionColor: the hide index's result): no distance-field jump from a hidden sample, the hit after it searched as "in the segment and not hidden" (hideAt) and lit by the hidden part's border (hideGrad), the hidden tests read the index texture's G channel (the hide index). Before: 8df122bbe60f9065c4e78846, an earlier change (the 色 / 表示 follow-up): the programs WITH results (VRL_REGIONS) changed again on purpose: the uniform regionAnyHidden (declared and read only under VRL_REGIONS) gates every regionHiddenAt read; the programs without results are as before. Earlier, an earlier change stage 2: the programs WITH results (VRL_REGIONS) changed on purpose: a hidden result is no hit / no cut face / no slice tint (regionHiddenAt / regionVis, sliceColorR, the loops' passH under VRL_HIDE); the ones without results are unchanged (the next test). Before: 058d2ba6624a57df951346b8, (after): 質感の色味 and skin / muscle / fat removed: the surface hit is the plain model again (the text of before: no vrlReal, no kind chain), every cut face calls vrlRealCut (lighting.js CUT_REAL, the muscle values; it replaces the plain cap's vrlShade), sliceLook keeps its gate (vrlRealCut has no material argument). Before: tissue look setting (9 kinds in the one vrlReal chain, the cut-face look for kinds 1..3 only: w < 3.5); before it: gloss trial (cut face / slice of skin / muscle / fat lit like the surface): sliceLook (a branch on segM[si].w, runs only at a slice or cap pixel, not per ray or sample), sliceColor takes the ray (rd, ro), the cap line adds vrlRealCut; vrlRealG / vrlRealCut are new helpers in lighting.js (no per-pixel cost when unused).: the lit line names the colour (vrlC) and the hit's normal / depth / keep (vrlN / vrlD / vrlK); skin / muscle / fat add vrlReal (a branch on segM[idx].w, 0 for the plain presets)
  });
});

describe('an earlier change: the programs WITHOUT results are the ones they were', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('no results, no child segments: the shader text of every variant is unchanged by the hidden-result code (it is all under VRL_REGIONS / VRL_HIDE)', () => {
    const t = shaderTemplate(src), V = [[], ['VRL_NO_GENERAL', 'VRL_OPAQUE'], ['VRL_NO_GENERAL', 'VRL_NO_EVENTS', 'VRL_OPAQUE']], h = createHash('sha256');
    for (const med of [0, 1]) for (const cls4 of [0, 1]) for (const v of V) h.update(preprocess(t, new Set([...v, ...(med ? ['VRL_MEDIUMP'] : []), ...(cls4 ? ['VRL_CLS4'] : [])])) + '\n--\n');
    expect(h.digest('hex').slice(0, 24)).toBe('780089e056aa4384f815afde'); // n731 fix2: gradientAtS in every program (see the APP SPEED test above). Before: f6f6cc005e27fae57955701e. // view-perf (n730): the jkA line above (the same number, no 2.0 * halfExt before the march) is in every program. Before: 41c3ec6c58c0181f2b0776b1, pair-perf: the jump change above (jkA, Q) is in every program, with or without results. Before: df8513fadf401e88acda8d31, the same hash for the source before an earlier change stage 2 (2284b70) and after
    for (const v of V) expect(preprocess(t, new Set(v))).not.toMatch(/regionHiddenAt|regionVis|passH|VRL_HIDE|sliceColorR/);
  });
});

describe('a hidden child segment is not tissue for the CPU paths (laser, hidden test, section tissue, histogram)', () => {
  const D = [4, 4, 4], HE = [1, 1, 1];
  const cls = { C: 1, data: new Uint8Array(64).fill(255) }; // every voxel is inside the only shown channel
  const hiddenAbove = (x, y, z) => z >= 2; // the far half of the box belongs to a hidden child
  it('classifiedAt: skipVoxel makes the voxel no tissue; without it the answer is as before', () => {
    const p = { x: 0, y: 0, z: 0.8 };
    expect(classifiedAt(p, HE, D, cls, [0])).toBe(true);
    expect(classifiedAt(p, HE, D, cls, [0], hiddenAbove)).toBe(false);
    expect(classifiedAt({ x: 0, y: 0, z: -0.8 }, HE, D, cls, [0], hiddenAbove)).toBe(true);
  });
  it('the laser march goes through the hidden voxels and stops at the first visible one (or at none)', () => {
    const o = { x: 0, y: 0, z: 3 }, q = { x: 0, y: 0, z: -1 }; // from +z towards -z
    const first = marchClassificationHitInfo(o, q, HE, D, cls, [0]);
    expect(first.z).toBe(3);
    const through = marchClassificationHitInfo(o, q, HE, D, cls, [0], [], 0, 0, 0, Infinity, hiddenAbove);
    expect(through.z).toBeLessThan(2);
    expect(marchClassificationHitInfo(o, q, HE, D, cls, [0], [], 0, 0, 0, Infinity, () => true)).toBeNull();
  });
  it('pointIsHidden: tissue that is a hidden child hides nothing', () => {
    const p = { x: 0, y: 0, z: 0.1 }, head = { x: 0, y: 0, z: 5 }; // the voxels between the point and the head are z >= 2
    expect(pointIsHidden(p, head, { cls, dims: D, halfExt: HE, chs: [0] })).toBe(true);
    expect(pointIsHidden(p, head, { cls, dims: D, halfExt: HE, chs: [0], skip: hiddenAbove })).toBe(false);
  });
  it('the histogram kernel: the voxel of a hidden child of slot s (marker 200 + s) is not counted as that segment (unlabeled), a shown result colour still labels', () => {
    const picks = Int32Array.from([0, 0]), c = new Uint8Array([200]), regSegs = Int32Array.from([1]);
    expect(labelAt(0, c, 1, picks, new Uint8Array([0]), regSegs)).toBe(1);
    expect(labelAt(0, c, 1, picks, new Uint8Array([200]), regSegs)).toBe(0);
    expect(labelAt(0, c, 1, picks, new Uint8Array([201]), regSegs)).toBe(1); // the marker of another slot does not touch this one
    expect(labelAt(0, c, 1, picks, new Uint8Array([1]), regSegs)).toBe(5);
  });
});

describe('child segments added / removed while the session runs (static: the session\'s source)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('syncChildSegments=()=>{\n   if(!running'), src.indexOf('  // binds the prepared data Pn'));
  it('compares the page\'s list with the prepared one, then: index, compile what is new, upload in slices, one synchronous bind; nothing else is rebuilt', () => {
    const order = ['if(have===want)return', 'buildChildIndexOf(', 'await compileSet(Pn,st)', "slicedTexture(k,child.rg", 'await uploadQueue.whenDone(k)', 'P.child=child;childList=', 'adoptSet(st)', 'material.uniforms.childTex.value=', 'refreshChildLut()', 'old?.dispose()'];
    let at = -1; for (const o of order) { const i = fn.indexOf(o, at + 1); expect(i, o).toBeGreaterThan(at); at = i; }
    for (const forbidden of ['prepareVrData(', 'releaseSessionData', 'unbindData', 'install(', 'volTex', 'regionTex', 'editTex']) expect(fn, forbidden).not.toContain(forbidden);
  });
  it('is started by the render hand-off\'s change event, and not while a data switch runs', () => {
    expect(src).toContain('const unsubLook=onChildRenderChange(()=>{if(!running)return;try{refreshChildLut()}catch(e){console.warn(e)}syncChildSegments();');
    expect(fn).toContain('ui.swapBusy');
  });
  it('the hidden tests read the hidden children: the probes\' gate key, the section tissue, the points, the histogram', () => {
    expect(src).toContain("key+='|kids'+childHideSig()");
    expect(src).toContain('classifiedAt(hit.point,vp.halfExt,vp.dims,vp.cls,chs,hiddenVoxel())'); // an earlier change: hiddenVoxel = the hidden children (hiddenChildVoxel) + the hidden results
    expect(src).toContain('skip:hiddenVoxel()');
    expect(src).toContain('const hiddenVoxel=()=>anyHiddenVoxel(hiddenChildVoxel(),hiddenRegionVoxel());');
    expect(src).toContain('hs.charCodeAt(i)');
  });
});
