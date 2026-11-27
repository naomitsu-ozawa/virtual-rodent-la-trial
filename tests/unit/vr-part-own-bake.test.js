// A detached part drawn by the ORDINARY program on its own baked bytes (docs/vr-part-view.js partBakeOwn + partBakeAlpha fresh, driven by vr-view.js pbFrame / pbBind / partRender).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partBakeOwn, partBakeRun, partSetWorkerSource, partBakeDiffBox, partBakeRewrite } from '../../docs/vr-part-view.js';

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
    expect(r).toContain('const nb=nOk&&q.nmats&&!!pbBoundOf(q);'); // (a): the bake of its field, or the held one of the set before while the new one is made
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
    expect(f).toContain('!ok||q.freed||x.src!==t.combo||cm!==x.mask');
    expect(f).toContain('if(b&&b.bkey!==q.bkey){'); // (a): a changed field holds the bound bake (q.pbOld) and makes a new one; the swap is pbBind's
    expect(f).toContain('if(b.bound){q.pbOld=b;q.pb=null;');
    expect(src.slice(src.indexOf('const pbBind='), src.indexOf('const pbFrame='))).toContain('if(q.pbOld){const o=q.pbOld;q.pbOld=null;pbFree(o)}');
    expect(src.slice(src.indexOf('const pbDrop='), src.indexOf('const pbDropAll='))).toContain('pbFree(b);pbFree(o);');
    expect(f).toContain('bakeApplying>0');
    expect(f).toContain('parts.find(q=>q.pb&&!q.pb.ready)');
    const ok = src.slice(src.indexOf('const pbOk='), src.indexOf('const pbStart='));
    for (const c of ['diagAn.noRegion', 'u.distInCls.value>0', 'u.useCls.value>0', '!t.rb?.busy', 't.comboMask===comboMask', '!ui.swapBusy']) expect(ok).toContain(c);
    expect(src).not.toContain('PART_BAKE_BYTES_MAX');
    expect(src.slice(src.indexOf('const pbStart='), src.indexOf('const pbBind='))).toContain('(four&&!four4)'); // never the whole body's fourth segment inside a part
    expect(src).toContain('partBakeDrop=()=>{bakeDrop();for(const q of parts)pbDrop(q)}'); // a part holding only its old bake (a) drops it too
    expect(src).toContain('const partFree=q=>{partHide(q);q.held=null;pbDrop(q);');
  });
  it('the part\'s own hidden flags follow its own tables', () => {
    expect(src).toContain('q.nu.regionAnyHidden.value=anyHiddenIn(q.lutOwnR.image.data,regionList.length)');
    expect(src).toContain('q.nu.childAnyHidden.value=bakeChildAnyHidden(q.lutOwnC.image.data,childList.length)');
  });
});

describe('vr-view.js: the body\'s bake is held while a part is cut out (F)', () => {
  it('partApply drops the bake at its start only without hold; the cut-out passes hold; the old body field texture goes with the bound bake', () => {
    expect(src).toContain('const partApply=(listOf,done=()=>{},upStage=()=>{},hold=false)=>{');
    expect(src).toContain('if(!hold)bakeDrop();bakeApplying++;');
    expect(src).toContain(",()=>cutStage('finish'),true).catch(");
    expect(src).toContain('const bb=r.boundB;if(bb&&!bb.fld&&ob)bb.fld={tex:ob,key:obk};else fieldDrop(ob,obk)');
    expect(src.slice(src.indexOf('const partApplyLeft='), src.indexOf('const partApplyLeft=') + 200)).not.toContain(',true)');
  });
  it('bodyBakeFrame holds the bound bake through a new set (bodyGen) and swaps it in one step when the next is ready; bakeApplying no longer drops it', () => {
    const f = src.slice(src.indexOf('const bodyBakeFrame='), src.indexOf('// ---- an earlier change: each detached part drawn'));
    expect(f).not.toContain('bakeApplying>0))bakeDrop()');
    expect(f).toContain('if(r.boundB===x){r.held=x;');
    expect(f).toContain('bakeSet(true);\n    if(r.held&&r.boundB===nb){const h=r.held;r.held=null;bakeFree(h)}');
    expect(f).toContain('if(!r.bake){if(r.held)bakeDrop();return}');
    const set = src.slice(src.indexOf('const bakeSet=on=>{'), src.indexOf('const bakeLight='));
    expect(set).toContain('swap=!!(on&&r.bakeBound&&r.boundB!==b)');
    expect(set).toContain('r.bakeBound=on;r.boundB=b;');
    expect(src).toContain('partBakeTex=()=>partRes?.bakeBound&&partRes.boundB?');
  });
  it('a part cut out after the bound bake was made is hidden by its voxels in the GPU\'s tables until the next bake is bound', () => {
    expect(src).toContain('uids:new Set(parts.map(q=>q.uid))');
    expect(src).toContain('targets.filter(t=>!bb||bb.uids.has(t.uid)).map(t=>t.i)');
    expect(src).toContain('targets.filter(t=>!bb||bb.uids.has(t.uid)).map(t=>t.j)');
  });
});

describe('vr-view.js: a bake that can start counts as the page hiding nothing (G2)', () => {
  it('bodyCutDraws reads partBakeCan while the page hides nothing; partBakeCan = no failed try for this body + the bake guard', () => {
    expect(src).toContain('const bodyCutDraws=()=>!!(parts.length&&(partHideSrc()||(!pageHides()&&partBakeCan()))&&!diagAn.noRegion&&partBodyDraws(variantKey()));');
    expect(src).toContain('partBakeCan=()=>{const r=partRes;return !!(r&&r.bakeSkip!==r.bodyGen&&bakeOkNow(r))};');
    expect(src).toContain('const ok=bakeOkNow(r);');
    expect(src).toContain('let partBakeOn=()=>false,partBakeCan=()=>false,');
  });
  it('the body\'s frame does not tolerate a hide-only rebuild (the parts\' rule is the parts\' own)', () => {
    expect(src.slice(src.indexOf('const bodyBakeFrame='), src.indexOf('const pbOk='))).not.toContain('hideOnly');
  });
});

describe('vr-view.js: a part that does not touch a new part keeps its field (c)', () => {
  it('partApply puts the part\'s earlier field in place of the new one where set.touch says it is not touched', () => {
    expect(src).toContain('if(set.touch)for(let i=0;i<list.length;i++){const q=list[i];if(!set.touch[i]&&q.pf&&q.ftex&&q.pf.sig===q.fsig)set.parts[i]=q.pf}');
  });
});

describe('vr-view.js: a held bake is rewritten in place where the new bytes differ (b)', () => {
  it('pbStart reuses the held texture for the same box / slots / source bytes; the worker\'s bytes are kept for the next comparison; one step writes the changed box and binds', () => {
    const st = src.slice(src.indexOf('const pbStart='), src.indexOf('const nCompiling='));
    expect(st).toContain('o.slots===slots&&o.src===t.combo&&o.mask===mask');
    expect(st).toContain('shared:inPlace,upd:inPlace?o:null');
    expect(st).toContain('{b.patch=res;b.keep=res;b.cut=res.slots|0}');
    const ip = src.slice(src.indexOf('const pbInPlace='), src.indexOf('const pbFrame='));
    expect(ip).toContain('partBakeRewrite(b,o.keep,b.patch,uploadQueue.bytesPerTickNow,bakeOps)');
    expect(ip).toContain("if(r.state==='big'){");
    expect(ip).toContain('b.bytes=o.bytes;o.bytes=0;o.tex=null;o.cls4Tex=null;b.shared=false;b.upd=null;b.patch=null;b.ready=true;');
    const fr = src.slice(src.indexOf('const pbFrame='), src.indexOf('partBakeFrame=()=>{bodyBakeFrame();pbFrame()}'));
    expect(fr).toContain('if(b.upd)pbInPlace(cur,b,t);');
    expect(src).toContain('const pbFree=b=>{if(!b)return;if(!b.shared){b.tex?.dispose();b.cls4Tex?.dispose()}');
  });
});

describe('vr-view.js: the body\'s held bake is rewritten in place where the new bytes differ (b)', () => {
  it('bakeStart shares the bound bake\'s texture only for the same box / slots / mask / source bytes / fourth channel; the worker\'s bytes are kept', () => {
    const st = src.slice(src.indexOf('const bakeStart='), src.indexOf('const bakeOps='));
    expect(st).toContain('o.ready&&o.keep&&r.bakeBound&&r.boundB===o&&o.slots===slots&&o.src===t.combo&&o.mask===mask&&!!o.cls4Tex===four4');
    expect(st).toContain('o.box.lo.every((v,i)=>v===box.lo[i])&&o.box.size.every((v,i)=>v===box.size[i])');
    expect(st).toContain('z:inPlace?cdims[2]:0');
    expect(st).toContain('shared:inPlace,upd:inPlace?o:null');
    expect(st).toContain('{b.patch=res;b.keep=res;b.cut=res.slots|0}');
  });
  it('one step writes the changed box and the new bake is bound in the same step; too much changed (or a failure) falls back to a texture of its own / the field draw', () => {
    const ip = src.slice(src.indexOf('const bakeInPlace='), src.indexOf('const bakeOkNow='));
    expect(ip).toContain('partBakeRewrite(b,o.keep,b.patch,uploadQueue.bytesPerTickNow,bakeOps)');
    expect(ip).toContain("if(w.state==='big'){");
    expect(ip).toContain('b.shared=false;b.upd=null;b.z=0;b.pz=0;');
    expect(ip).toContain('bakeDrop();return}');
    expect(ip).toContain('o.tex=null;o.cls4Tex=null;b.shared=false;b.upd=null;b.patch=null;b.ready=true;');
    const fr = src.slice(src.indexOf('const bodyBakeFrame='), src.indexOf('// ---- an earlier change: each detached part drawn'));
    expect(fr).toContain('if(nb.upd){if(nb.patch)bakeInPlace(r,nb,t);if(r.bake!==nb)return}');
    expect(fr).toContain('if(!nb.ready&&!nb.upd)bakeStep(nb,t);');
    expect(fr.indexOf('bakeInPlace(r,nb,t)')).toBeLessThan(fr.indexOf('bakeSet(true);'));
    expect(src).toContain('const bakeFree=b=>{if(!b)return;if(!b.shared){b.tex?.dispose();b.cls4Tex?.dispose()}b.keep=null;');
  });
});

describe('vr-view.js: a part is shown as soon as its own field is on the GPU (A)', () => {
  const d = src.slice(src.indexOf('const partDetach=async tg=>{'), src.indexOf('const partHold='));
  it('only when a set of parts is already in place; the part keeps no pf / fsig until the set installs; the set\'s list does not count it twice', () => {
    expect(d).toContain('const early=!!(res.body?.ok&&parts.length&&fcodes);');
    expect(d).toContain('q.ftex=ft.tex;q.ftexKey=ft.key;fieldUniforms(q.u,pf0,q.ftex,a,b,q.fieldDims);attach(\'own-field\');');
    expect(d).toContain('partApply(()=>parts.includes(q)||q.freed?[...parts]:[...parts,q],()=>attach(\'set\'),()=>cutStage(\'finish\'),true)');
    expect(d).toContain('const live=()=>!q.freed&&!parts.includes(q)&&running&&P===P0&&partRes===res&&!!material;');
  });
  it('attach shows a part once and never a freed one; a failed set takes an early part out again', () => {
    expect(d).toContain('if(q.freed||parts.includes(q))return;');
    expect(d).toContain('if(!q.freed){const i=parts.indexOf(q);if(i>=0){parts.splice(i,1);');
  });
});

describe('partBakeDiffBox / partBakeRewrite: the changed box is written in one step, nothing when nothing changed, nothing when too much changed (b)', () => {
  const size = [6, 5, 4], n = 120, mk = () => ({ rgba: new Uint8Array(n * 4), c4: new Uint8Array(n) });
  const ops = () => { const log = []; return { log, wrap: (data, dims, C) => ({ data, dims, C }), copy: (src, dst, lo, hi, at) => log.push({ src, dst, lo, hi, at }), drop: () => log.push('freed') }; };
  const at = (x, y, z) => x + 6 * (y + 5 * z);
  it('the box of the differing voxels (any of the four bytes, or the fourth channel)', () => {
    const A = mk(), B = mk();
    expect(partBakeDiffBox(A, B, size)).toBe(null);
    B.rgba[at(2, 1, 1) * 4 + 3] = 9; B.c4[at(4, 3, 2)] = 1;
    expect(partBakeDiffBox(A, B, size)).toEqual({ lo: [2, 1, 1], size: [3, 3, 2] });
  });
  it('writes only that box at its place in the texture (the box\'s own lo added), then drops the wrappers; the bytes are the new ones', () => {
    const A = mk(), B = mk(); B.rgba[at(2, 1, 1) * 4] = 77; B.c4[at(2, 1, 1)] = 5;
    const o = ops(), b = { box: { lo: [10, 20, 30], size }, tex: { t: 1 }, cls4Tex: { t: 4 } };
    const r = partBakeRewrite(b, A, B, 1 << 20, o);
    expect(r).toEqual({ state: 'done', bytes: 5 });
    const c = o.log.filter(e => e !== 'freed');
    expect(c.length).toBe(2); expect(c[0].dst).toBe(b.tex); expect(c[0].at).toEqual([12, 21, 31]); expect(c[0].hi).toEqual([1, 1, 1]);
    expect(Array.from(c[0].src.data)).toEqual([77, 0, 0, 0]); expect(Array.from(c[1].src.data)).toEqual([5]); expect(c[1].dst).toBe(b.cls4Tex);
    expect(o.log.filter(e => e === 'freed').length).toBe(2);
  });
  it('nothing differs: nothing is written; more than the budget differs: nothing is written either', () => {
    const A = mk(), B = mk(), o = ops(), b = { box: { lo: [0, 0, 0], size }, tex: {}, cls4Tex: null };
    expect(partBakeRewrite(b, A, B, 1 << 20, o)).toEqual({ state: 'same', bytes: 0 }); expect(o.log.length).toBe(0);
    for (let i = 0; i < n; i++) B.rgba[i * 4] = 1;
    expect(partBakeRewrite(b, A, B, 100, o)).toEqual({ state: 'big', bytes: n * 4 }); expect(o.log.length).toBe(0);
  });
});

describe('vr-view.js: the hidden-state rule while a target is hidden by something the state does not name', () => {
  it('hideVMode stays 0 for a part without its set (A), a part cut out after the bound bake (F) and the field / the bake cut while the page hides nothing (G2)', () => {
    expect(src).toContain('u.hideVMode.value=rb&&rb.hideValid(cur,vis)&&!partHideLoose(cutDraws)?1:0;');
    const f = src.slice(src.indexOf('partHideLoose=cutDraws=>{'), src.indexOf('const bodyBakeFrame='));
    expect(f).toContain('parts.some(q=>!q.pf)');
    expect(f).toContain('parts.some(q=>!r.boundB.uids.has(q.uid))');
    expect(f).toContain('!!cutDraws&&!partHideSrc()');
  });
  it('the table\'s cut bit is set only for a part that has its field (A: no double draw by the VRL_PART body)', () => {
    expect(src).toContain('markCutRegionLut(a,targets.filter(t=>pfUid.has(t.uid)).map(t=>t.i))');
    expect(src).toContain('markCutChildLut(a,targets.filter(t=>pfUid.has(t.uid)).map(t=>t.j))');
  });
});
