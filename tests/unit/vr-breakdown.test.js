// The WebGPU volume breakdown of the performance record (one 30 s recording from the detail tab): the WGSL variants (the display text is unchanged), the shadow passes and the counting probe of vr-wgpu.js
// (driven with a mock device: CI has no GPU), the pure collector and report section of vr-perf-log.js, and the wiring in vr-view.js (static).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, ABLATIONS, COUNTER_FIELDS, uniformLayout, proxyWgsl, proxyDiffWgsl } from '../../docs/vr-wgsl-core.js';
import { createVrVolumeRenderer, regionClip, regionMvp, gxShaderInfo } from '../../docs/vr-wgpu.js';
import { MARCH_VARIANTS, marchWgsl } from '../../docs/vr-wgpu-coarse-march.js';
import { createVolBreakdown, createPerfLog, perfReport, BD_VARIANTS, BD_SPECS, BD_PROBE_FIELDS, BD_NEAR_R, defineBdVariant } from '../../docs/vr-perf-log.js';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const vr = read('vr-view.js'), host = read('vr-wgpu.js');
const sha = t => createHash('sha256').update(t).digest('hex');
// sha256 of the display variants' text before the creep check was gated (the text of and 749, which are the same): [f16, cls4, events, hash]
const DISPLAY_HASHES_BEFORE_GATE = [
  [false, false, false, '83f53706ab37b1bbd239df0e2851cb4ea654e71fd2c37bdd822e0fece2628915'],
  [false, false, true, '26e8fa1442b8272987ce7cf8c8d67c6af53657aa12aa1d62c553e6f58d28ac75'],
  [false, true, false, '9ac3b204fb37b1df9cdb8245d80ec900ac90037ab2aecf40542707278470cf10'],
  [false, true, true, '1fa0b6fc627c4b189747779b3711f0152c04d5ddb93093cd1b3b02d4e9c1f9a6'],
  [true, false, false, 'f9eccad985aa2f6a8a3816c5cd423c41b03da0cb2bec05d04d587a18fe406e51'],
  [true, false, true, '7604c1c693c81282bd7288f58e2a3f7c2857c3b485e292aafdfcada6699e361f'],
  [true, true, false, '1cc6f7c1bd81a9fbe6ee1ab04fb76b064f4898e641d602f38f47c98bea110d87'],
  [true, true, true, '7ce8ffdf17bcc99f4332f65c8ef35d76c3a4904aeb9b93595a9b01a00923e448'],
];
// sha256 of the display variants' text of to 752 (the creep check gated, t accumulated by t += step): [f16, cls4, events, hash]
const DISPLAY_HASHES_BEFORE_GRID = [
  [false, false, false, '7e15da7195e22d9e136804b51b4139a9acc5d5ab03a7a464cc6ffb7250f9b7d7'],
  [false, false, true, '4e2025d308c8880b282b342c126a322e2a3b6f78edd24179b6bcdf52175d51ee'],
  [false, true, false, '09dfb5e60b9653b5d9ce61c4618a850ea50dc958d25593aa3be4f3c6bccb13a6'],
  [false, true, true, '0f589a63f8533f11c15bdcd26f0b7f644cc8b047dda33504d0a14c47ddc2c481'],
  [true, false, false, '0db5ebd0444672779c6cb479ea56ceb283c0a057eb08992ea257160c30855464'],
  [true, false, true, '5485e6c08b714899f863f2952edb4af04a15d211706c265e661dd5c035cfd3fa'],
  [true, true, false, 'f2a350e6d48888861cf5a5688ad8a2889bbc196b71552f013875b70cc07b6b97'],
  [true, true, true, '126b209ed29237876db28eeb31e5b8aa8b3ad561d9213da11fac7906fc57032c'],
];
// sha256 of the display variants' text of (t = t0 + k * step, made in one place at the top of the loop: see the grid tests below; before the pre-pass start): [f16, cls4, events, hash]
const DISPLAY_HASHES_BEFORE_PROXY = [
  [false, false, false, '141dcd4f08128c6164aa69cb6640d847f1e5c0214a419652eb6cbcea57153f71'],
  [false, false, true, '33ed1741f9293f0289248566c95082bf10492dfd631e07970bc07bb4cd06587d'],
  [false, true, false, '065682466a4b75abb5e4e3467e61c1bbf0dd013e96afa2544c7810900369ad8a'],
  [false, true, true, 'a65919fd999419c6e9514d4ba1380f57cd7e79402b0b80e9593a57549324c4a6'],
  [true, false, false, 'bf518adfae55016ef26ee811069fcb581a31c93e96ae41841a42a7899c4450e6'],
  [true, false, true, '240d75dcb83ac5008be7182091dfbaf9ddd6c2c6bb294ad0e2f55143b788ddd8'],
  [true, true, false, '704c4c22307c0e6a352f3db6b09dcafa953c93f715d1ded6577af3f31f3e8caa'],
  [true, true, true, '3b29b78671df07485cde255bae38a0d4cd3d25b7644fbe2ea56a9370ec1fae27'],
];
// sha256 of the display variants' text now: [f16, cls4, events, hash]
const DISPLAY_HASHES = [
  [false, false, false, 'bfdf339e6832bd1ae6ed2af7e816161786f7bb47881240b8a9bae0cdf0b6f16c'],
  [false, false, true, '6ef5e400841ff248c3e0345ca3d6ad3c1a924246def919570e5db9ae20a5b194'],
  [false, true, false, '64431c184cb0dc0cd5e8d486e93491813879182419bc0c5ebe736dcf9c79bf99'],
  [false, true, true, 'e11d6a1302d874ccfc46491491c6607826d66cc97998abc80c0e9bf163ac2b08'],
  [true, false, false, '152437d63dcb85ee204f0624a77139b0f67b377999cc6f6369f851cf7bfe6f96'],
  [true, false, true, '63a932e79eec80d541eb78d56ba30dbf33b274fdc6ddcb8ba8da1c37271576c6'],
  [true, true, false, '836bb5fc9ce52abd77ae4c369b8c72a585ee8bb3fed6c04551a161c6fae3ff8c'],
  [true, true, true, '5926bc54a1dd50409f1d9f4ef0e824c72fe523aff9ea298daf38f07bb24d476b'],
];
const NF = COUNTER_FIELDS.length; // u32 per probe pixel
const BASES = []; for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const events of [false, true]) BASES.push({ f16, cls4, events });

// the pre-pass: the display text of differs from the text of only by these edits (the old text is made back from the new one and must hash to the old value)
const unproxy = t => t
  .replace(' jumpOn:i32,\n proxyOn:i32,\n proxyOrg:vec2<i32>,\n pad1:i32,\n};', ' jumpOn:i32,\n pad0:i32,\n pad1:i32,\n pad2:i32,\n};')
  .replace('@group(0) @binding(9) var proxyTex:texture_2d<f32>;\n', '')
  .replace(/ \/\/ the pre-pass \(build 754\)[\s\S]*?k=max\(0,i32\(floor\(\(tA-t0\)\/stp\)\)-1\);\}\n \}\n/, '')
  .replace('for(var iter=select(0,4096,emptyRay);iter<4096;iter++){', 'for(var iter=0;iter<4096;iter++){');
describe('WGSL: the display variants are the text below, character for character (a change of the display text changes these hashes: update them on purpose)', () => {
  it.each(DISPLAY_HASHES)('f16=%s cls4=%s events=%s', (f16, cls4, events, hash) => {
    expect(sha(volumeWgsl({ f16, cls4, events }))).toBe(hash);
    expect(sha(volumeWgsl({ f16, cls4, events, abl: '', counters: false }))).toBe(hash);
  });
  it('the defaults of volumeWgsl are the display variant with the section code (as before)', () => { expect(volumeWgsl()).toBe(volumeWgsl({ f16: false, cls4: false, events: true })); });
});

// the grid: the display text differs from the text of to 752 only by these edits (the old text is made back from the new one and must hash to the old value)
const ungrid = t => t
  .replace('let t0=t;var k=0; // the ray\'s sample grid: every sample is t0 + k * stp (one expression, made at the top of the loop); a step is k++, a jump is k += m\n var jumpLen=0.0;', 'let t0=t;var jumpLen=0.0;')
  .replace('  let t=t0+f32(k)*stp;\n  if(t>endT', '  if(t>endT')
  .replace('lastIndex=ci;previousT=t;k++;continue;', 'lastIndex=ci;previousT=t;t+=stp;continue;')
  .replace('lastIndex=-1;previousT=t;k++;continue;}', 'lastIndex=-1;previousT=t;t+=stp;continue;}')
  .replace('  // a jump is never shorter than a normal step (m >= 1); it lands on the same t0 + k * step grid\n  if(dd>=2.7){let m=max(1,i32(floor((dd-1.8)*jkA/stp)));let nextJ=t0+f32(k+m)*stp;jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;k+=m;continue;}',
    '  // a jump is never shorter than a normal step; it lands on the same t0 + k * step grid\n  if(dd>=2.7){let nextJ=t+stp*max(1.0,floor((dd-1.8)*jkA/stp));jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;t=nextJ;continue;}')
  .replace('  previousT=t;k++;\n }\n if(hitIdx>=0){', '  previousT=t;t+=stp;\n }\n if(hitIdx>=0){')
  .replace('previousT = t, k++ (the next grid point), exactly as the skip does', 'previousT = t, t += stp, exactly as the skip does');
describe('WGSL: the pre-pass start', () => {
  it.each(DISPLAY_HASHES_BEFORE_PROXY)('f16=%s cls4=%s events=%s: without the pre-pass edits the text is the one of', (f16, cls4, events, hash) => {
    const t = volumeWgsl({ f16, cls4, events });
    expect(sha(unproxy(t))).toBe(hash);
    if (events) expect(t).not.toContain('emptyRay'); else { expect(t).toContain('var emptyRay=false;'); expect(t).toContain('if(u.proxyOn==1){'); }
    expect(t).toContain('@group(0) @binding(9) var proxyTex:texture_2d<f32>;');
  });
});
describe('WGSL: the grid (t = t0 + k * step)', () => {
  it.each(DISPLAY_HASHES_BEFORE_GRID)('f16=%s cls4=%s events=%s: without the grid edits the text is the one of to 752', (f16, cls4, events, hash) => {
    const t = volumeWgsl({ f16, cls4, events });
    expect(t).toContain('  let t=t0+f32(k)*stp;\n'); expect(t).not.toContain('t+=stp');
    expect(sha(ungrid(unproxy(t)))).toBe(hash);
  });
});

// the creep gate: the display text differs from the text before it only by these edits (the old text is made back from the new one and must hash to the old value)
const ungate = t => t
  .replace(' var chk=false; // the creep check is made only while the ray is near a surface (see below): false at the ray start and after a jump\n', '')
  .replace(/  \/\/ The bit is looked up only when chk[\s\S]*?those of the skip\n/, '')
  .replace('if(skipOn&&chk){', 'if(skipOn){').replace('  chk=dd<2.7;\n', '');
describe('WGSL: the creep gate', () => {
  it.each(DISPLAY_HASHES_BEFORE_GATE)('f16=%s cls4=%s events=%s: without the gate edits the text is the one before', (f16, cls4, events, hash) => {
    const t = volumeWgsl({ f16, cls4, events });
    expect(t).toContain('if(skipOn&&chk){'); expect(t).toContain('  chk=dd<2.7;\n'); expect(t).toContain(' var chk=false;');
    expect(sha(ungate(ungrid(unproxy(t))))).toBe(hash);
  });
  it('the check is made at most where the previous sample was read near a surface: chk is set from dd right after the override and before the jump, never set by a jump, and starts false', () => {
    const t = volumeWgsl();
    expect(t.split('chk=').length - 1).toBe(2); // the declaration and the one assignment
    const a = t.indexOf('if(u.jumpOn==0){dd=0.0;}\n  chk=dd<2.7;\n'), j = t.indexOf('if(dd>=2.7){let m=');
    expect(a).toBeGreaterThan(0); expect(j).toBeGreaterThan(a); // the jump comes after the assignment: a jump leaves chk false
    expect(t.indexOf('if(skipOn&&chk){')).toBeLessThan(t.indexOf('var q=textureSampleLevel(clsTex,smp,tcS,0.0)'));
  });
  it('the counting twin and the ablations take the same gate (their anchors still hold), the display text keeps skipOn from useSkip (the host passes 0)', () => {
    for (const v of [{ counters: true }, ...ABLATIONS.map(abl => ({ abl })), ...ABLATIONS.map(abl => ({ abl, counters: true }))]) {
      const t = volumeWgsl(v);
      expect(t, JSON.stringify(v)).toContain('if(skipOn&&chk){'); expect(t).toContain('chk=dd<2.7;');
    }
    expect(volumeWgsl()).toContain('let skipOn=u.useSkip>0&&u.diag!=4;');
  });
});

describe('WGSL: the breakdown variants (abl, counters)', () => {
  const base = volumeWgsl({ events: true });
  it.each(BASES.flatMap(b => [...ABLATIONS.map(abl => ({ ...b, abl })), { ...b, counters: true }]))('%o is read by wgsl_reflect, keeps the entry points and differs from the display text', v => {
    const t = volumeWgsl(v);
    expect(t).not.toMatch(/undefined|NaN|\$\{/);
    const r = new WgslReflect(t);
    expect(r.entry.vertex.map(e => e.name)).toEqual(['vs']); expect(r.entry.fragment.map(e => e.name)).toEqual(['fs']);
    expect(t).not.toBe(volumeWgsl({ f16: v.f16, cls4: v.cls4, events: v.events }));
  });
  it('abl grad: no gradient fetch call (n stays -dir), the search stays; abl refine: no surface search; abl shade: no shading call, the normal still feeds the result through f32(u.pad1)', () => {
    const g = volumeWgsl({ abl: 'grad' }), rf = volumeWgsl({ abl: 'refine' }), sh = volumeWgsl({ abl: 'shade' });
    expect(base).toContain('n=gradientAtS(tc,idx);'); expect(g).not.toContain('n=gradientAtS(tc,idx);'); expect(g).toContain('entryFaceNormal(o,dir)'); expect(g).toContain('if(hitSimple){}');
    expect(base).toContain('two secant guesses'); expect(rf).not.toContain('two secant guesses'); expect(rf).not.toContain('clsAt(tcO+tcD*mid)'); expect(rf).toContain('let hp=o+dir*hi;'); expect(rf).toContain('n=gradientAtS(tc,idx);');
    expect(base).toContain('vrlShade(nn,viewDir'); expect(sh).not.toContain('vrlShade(nn,viewDir'); expect(sh).toContain('f32(u.pad1)'); expect(sh).toContain('nn.x+nn.y+nn.z'); expect(sh).toContain('let lit=u.segC[idx].rgb*shade.x+vec3<f32>(shade.y);');
    expect(base).not.toContain('f32(u.pad1)');
  });
  it('pad1 is 0 at run time: the packer never gets a value for it (it is in no uniforms object of the session)', () => {
    expect(uniformLayout().fields.map(f => f.name)).toContain('pad1');
    expect(vr).not.toMatch(/pad1\s*:\s*\{?\s*value/);
  });
  it('counters: a storage buffer in group 1 (writable, fragment), COUNTER_FIELDS.length u32 a pixel from the position, no discard left, every counter has its place', () => {
    const t = volumeWgsl({ counters: true });
    expect(t).toContain('@group(1) @binding(0) var<storage,read_write> cnt:array<u32>;');
    const r = new WgslReflect(t);
    const g1 = r.getBindGroups()[1]; expect(g1).toHaveLength(2); expect(g1.map(x => x.name + ':' + x.binding)).toEqual(['cnt:0', 'cntCfg:1']); // the counts, and the window / tile mapping (a uniform)
    expect(t).not.toContain('discard;'); expect(base).toContain('discard;');
    expect(t).toContain('fn fsMain(in:VOut)->FOut{'); expect(t).toContain('@fragment fn fs(in:VOut)->FOut{');
    expect(t).toContain('(u32(in.pos.y)*CNT_W+u32(in.pos.x))*' + NF + 'u');
    expect(COUNTER_FIELDS).toHaveLength(18); expect(BD_PROBE_FIELDS).toEqual(COUNTER_FIELDS);
    for (const x of ['gIters+=1u', 'gCreep+=1u', 'gJumps+=1u', 'gSkipRd+=1u', 'gClsRd+=1u', 'gRefRd+=1u', 'gGradRd+=6u', 'gOut=1u', 'gOut=3u', 'gOut=4u']) expect(t, x).toContain(x);
    // the approach counts: read from dd before the jumpOn override (so a run without jumps still measures the field), at the first sample within 4 / 8 / 16; the display text has none of it
    expect(t).toContain('cntNear(dd);if(u.jumpOn==0){dd=0.0;}\n  chk=dd<2.7;'); expect(t).toContain('if(gN4==0u&&dd<=4.0){gN4=gIters;gJ4=gJumps;}'); expect(t).toContain('if(gN8==0u&&dd<=8.0){gN8=gIters;gJ8=gJumps;}'); expect(t).toContain('if(gN16==0u&&dd<=16.0){gN16=gIters;gJ16=gJumps;}');
    expect(t).toContain('cnt[b+8u]=gN4;cnt[b+9u]=gJ4;cnt[b+10u]=gN8;cnt[b+11u]=gJ8;cnt[b+12u]=gN16;cnt[b+13u]=gJ16;'); expect(COUNTER_FIELDS.slice(8, 14)).toEqual(['near4Steps', 'near4Jumps', 'near8Steps', 'near8Jumps', 'near16Steps', 'near16Jumps']);
    expect(base).not.toContain('cntNear'); expect(base).not.toContain('gN4');
    expect(t.split('gClsRd+=1u').length - 1).toBe(2); expect(t.split('gRefRd+=1u').length - 1).toBe(2);
    expect(r.entry.fragment.map(e => e.name)).toEqual(['fs']);
  });
  it('the display variants have no storage binding and no group 1', () => { expect(base).not.toContain('@group(1)'); expect(new WgslReflect(base).getBindGroups()).toHaveLength(1); });
  it('counters: the place counts (toTA, last-near per R) and the pre-pass start of the twin: the tile comes from cntTileA (the window mapping), tA is read in every run, only proxyOn == 1 moves k; the display text has none of it; a text without the start (sections) keeps toTA 0', () => {
    for (const cls4 of [false, true]) {
      const t = volumeWgsl({ cls4, events: false, counters: true });
      expect(t).toContain('struct CntCfg{sc:vec4<f32>,lim:vec4<f32>};'); expect(t).toContain('@group(1) @binding(1) var<uniform> cntCfg:CntCfg;');
      expect(t).toContain('iters++;gIters+=1u;if(k<gKs){gA+=1u;}');
      expect(t).toContain('let tA=cntTileA(in.pos.xy);'); expect(t).not.toContain('textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0)'); // the display's lookup is replaced
      expect(t).toContain('if(cntCfg.lim.z>0.5){gKs=select(kS,1073741824,em);}'); expect(t).toContain('if(u.proxyOn==1){if(em){emptyRay=true;}else{k=kS;}}');
      expect(t).toContain('if(dd<=4.0){gL4=gIters;}if(dd<=8.0){gL8=gIters;}if(dd<=16.0){gL16=gIters;}');
      expect(t).toContain('cnt[b+14u]=gA;cnt[b+15u]=gL4;cnt[b+16u]=gL8;cnt[b+17u]=gL16;'); expect(COUNTER_FIELDS.slice(14)).toEqual(['toTA', 'last4Steps', 'last8Steps', 'last16Steps']);
      // the tile lookup outside the region or without tiles is tA 0 (the ray starts as it would without the pre-pass), the lookup itself is the display's tile = pixel / 8
      expect(t).toContain('if(cntCfg.lim.z<0.5){return 0.0;}'); expect(t).toContain('if(q.x<0||q.y<0||q.x>=i32(cntCfg.lim.x)||q.y>=i32(cntCfg.lim.y)){return 0.0;}'); expect(t).toContain('return textureLoad(proxyTex,q/8,0).r;');
      expect(volumeWgsl({ cls4, events: false })).toContain('textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0)'); expect(volumeWgsl({ cls4, events: false })).not.toContain('cntTileA');
    }
    const ev = volumeWgsl({ events: true, counters: true }); expect(ev).not.toContain('cntTileA(in.pos.xy)'); expect(ev).toContain('gKs'); expect(new WgslReflect(ev).getBindGroups()[1]).toHaveLength(2);
  });
  it('an unknown abl is an error, and the header comment of a variant says which it is', () => {
    expect(() => volumeWgsl({ abl: 'nope' })).toThrow();
    expect(volumeWgsl({ abl: 'grad' })).toContain('events=true abl=grad counters=false');
    expect(volumeWgsl({ counters: true, f16: true })).toMatch(/^enable f16;\n\/\/ VR \/ AR volume pass \(WGSL\), variant f16=true cls4=false events=true abl=none counters=true\n/);
  });
});

describe('the collector (createVolBreakdown)', () => {
  const feed = (vb, name, ratio, n, low = 10) => { for (let i = 0; i < n; i++) vb.add(name, ratio * low, low); };
  it('R_v is the median ratio, M the median low pass ms, est = (R_same - R_v) x M, withCreep / noJump come out negative', () => {
    const vb = createVolBreakdown();
    feed(vb, 'same', 1, 5); feed(vb, 'box', 0.2, 5); feed(vb, 'simple', 0.7, 5); feed(vb, 'noGrad', 0.9, 5); feed(vb, 'noRefine', 0.85, 5); feed(vb, 'noShade', 0.95, 5); feed(vb, 'withCreep', 1.2, 5); feed(vb, 'noJump', 1.5, 5);
    const s = vb.summary();
    expect(s.M).toBeCloseTo(10); expect(s.nLow).toBe(40);
    expect(s.variants.same).toMatchObject({ n: 5, est: null }); expect(s.variants.same.R).toBeCloseTo(1);
    expect(s.variants.box.est).toBeCloseTo(8); expect(s.variants.noGrad.est).toBeCloseTo(1); expect(s.variants.noRefine.est).toBeCloseTo(1.5); expect(s.variants.noShade.est).toBeCloseTo(0.5);
    expect(s.variants.withCreep.est).toBeCloseTo(-2); expect(s.variants.noJump.est).toBeCloseTo(-5);
    // split: fixed = R_box x M, march = (R_simple - R_box) x M - shading, refine / gradient / shading = est; sum against M
    expect(s.split.fixed).toBeCloseTo(2); expect(s.split.shading).toBeCloseTo(0.5); expect(s.split.march).toBeCloseTo(4.5); expect(s.split.refine).toBeCloseTo(1.5); expect(s.split.gradient).toBeCloseTo(1);
    expect(s.split.sum).toBeCloseTo(9.5); expect(s.split.pct).toBeCloseTo(95);
  });
  it('the median and the quartiles of a ratio come from the samples (a middle sample does not move the median)', () => {
    const vb = createVolBreakdown(); for (const r of [1, 2, 3, 4, 100]) vb.add('same', r, 1);
    const x = vb.summary().variants.same; expect(x.R).toBe(3); expect(x.q1).toBe(2); expect(x.q3).toBe(4); expect(x.n).toBe(5);
  });
  it('no sample: "-" everywhere (no NaN, no 0), also for a variant that has none while the others have', () => {
    const vb = createVolBreakdown(); const empty = vb.lines().join('\n');
    expect(empty).not.toMatch(/NaN|undefined|Infinity/); expect(empty).toContain('abl box n=0 ratio - (IQR -) · est -'); expect(empty).toContain('low pass median - ms (0) · low share of vol -'); expect(empty).toContain('split: fixed(box) - ');
    expect(empty).toContain('probe whole: -'); expect(empty).toContain('probe native: -');
    vb.add('same', 5, 5); const l = vb.lines().join('\n'); expect(l).toContain('abl same n=1 ratio 1.00'); expect(l).toContain('abl noJump n=0 ratio - (IQR -) · est -'); expect(l).toContain('split: fixed(box) - ');
  });
  it('a sample with a bad ms is no sample (zero low pass, negative or non-finite shadow, unknown variant)', () => {
    const vb = createVolBreakdown();
    expect([vb.add('same', 1, 0), vb.add('same', -1, 5), vb.add('same', NaN, 5), vb.add('same', 1, Infinity), vb.add('nope', 1, 5)]).toEqual([false, false, false, false, false]);
    expect(vb.add('same', 5, 5)).toBe(true); expect(vb.summary().nLow).toBe(1);
  });
  it('the shadow ms never reaches the log\'s own columns (vol stays empty)', () => {
    const log = createPerfLog({ kind: 'webgpu', now: () => 1000, store: null }); log.vb = createVolBreakdown(); log.vb.add('same', 7, 7);
    const row = log.row({ menu: 0, rec: 1 }, 1000); expect(row.vol).toBeNull(); expect(row.rec).toBe(1);
  });
  it('the summary leaves the recorded rows out (their GPU is loaded by the shadow passes) and says how many; without a recording it is as before', () => {
    const log = createPerfLog({ kind: 'webgpu', now: () => 0, store: null });
    log.row({ menu: 0, rec: 0, fps: 72 }, 1000); log.row({ menu: 0, rec: 0, fps: 70 }, 2000); log.row({ menu: 0, rec: 1, fps: 30 }, 3000); log.row({ menu: 1, rec: 1, fps: 30 }, 4000);
    const s = log.summary(); expect(s.closedRows).toBe(2); expect(s.recLeft).toBe(1); expect(s.fps).toBe(71);
    expect(perfReport(log, {})).toContain('-- summary (rows with the menu closed: 2 of 4, 1 rows of the breakdown recording left out)');
    const plain = createPerfLog({ kind: 'webgpu', now: () => 0, store: null }); plain.row({ menu: 0, rec: 0, fps: 72 }, 1000);
    expect(perfReport(plain, {})).toContain('-- summary (rows with the menu closed: 1 of 1)');
  });
  it('the report section: the lines of the spec, the low share from the vol column of the recorded rows, notes in English, no filtering by the menu', () => {
    const log = createPerfLog({ kind: 'webgpu', now: () => 0, store: null }); const vb = log.vb = createVolBreakdown(); vb.seconds = 30.2;
    for (const [v, r] of [['same', 1], ['box', 0.3], ['simple', 0.6], ['noGrad', 0.9], ['noRefine', 0.9], ['noShade', 0.9], ['withCreep', 1.1], ['noJump', 1.2]]) for (let i = 0; i < 4; i++) vb.add(v, r * 5, 5);
    const c = new Uint32Array(64 * 64 * NF); for (let i = 0; i < 64 * 64; i++) { c[i * NF] = i % 4 === 0 ? 1 : 2; c[i * NF + 1] = 5 + (i % 9); c[i * NF + 5] = 5; }
    vb.addProbe('whole', c, 64, 64); vb.addProbe('native', c, 64, 64);
    log.row({ menu: 1, rec: 1, fps: 40 }, 1000); log.rows[0].vol = 10; // a row with the menu open is used as well
    const t = perfReport(log, {}).split('\n'), i = t.indexOf('-- vol breakdown (recording, paired shadow passes)');
    expect(i).toBeGreaterThan(0);
    expect(t[i + 1]).toBe('rec 30 s · shadow every 4th frame · low pass median 5.00 ms (32) · low share of vol 0.50');
    expect(t[i + 2]).toMatch(/^abl same n=4 ratio 1\.00 \(IQR 1\.00-1\.00\) · est -$/); expect(t[i + 3]).toMatch(/^abl box n=4 ratio 0\.30 \(IQR 0\.30-0\.30\) · est 3\.5 ms$/);
    expect(t.slice(i, i + 60).some(l => l.startsWith('split: fixed(box) 1.5 ms · march '))) /* (60: the variants' lines and the comparison lines of every group come before it) */.toBe(true);
    expect(t.some(l => l.startsWith('probe whole: windows 1 · px 4096 · steps mean/p50/p95/max '))).toBe(true); expect(t.some(l => /^probe native: windows 1 · blocks 64 · block max\/mean median\/p90 /.test(l))).toBe(true);
    const notes = t.filter((l, k) => k > i && l.startsWith('note: ')); expect(notes.length).toBeGreaterThanOrEqual(5);
    expect(notes.join('\n')).toMatch(/shadow pass/); expect(notes.join('\n')).toMatch(/8 x 8 pixels, an approximation of a GPU wave/); expect(notes.join('\n')).toMatch(/span, gap, swd and fps of those rows are disturbed/); expect(notes.join('\n')).not.toMatch(/[぀-ヿ一-鿿]/);
  });
  it('probe blocks: 8 x 8 pixels, max / mean of the work per block, mixed = hit and non-hit in one block', () => {
    const w = 16, h = 8, c = new Uint32Array(w * h * NF);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * NF; c[o] = 2; c[o + 1] = x < 8 ? 10 : 10; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) c[(y * w + x) * NF] = 1; // the left block: half hits (mixed)
    c[(3 * w + 12) * NF + 1] = 90; // the right block: one heavy pixel: max 90, mean (63 x 10 + 90) / 64
    const vb = createVolBreakdown(); expect(vb.addProbe('native', c, w, h)).toBe(true);
    const n = vb.summary().probes.native;
    expect(n.blocks).toBe(2); expect(n.mixedShare).toBeCloseTo(0.5);
    expect(n.blockMax.median).toBeCloseTo((1 + 90 / ((63 * 10 + 90) / 64)) / 2); expect(n.outcome.hit).toBeCloseTo(32 / 128);
  });
  it('probe whole by outcome: the steps (mean / p95), jumps, creep and skipTex reads per pixel of the hit pixels and of the pass pixels, after the probe whole line; other outcomes are left out', () => {
    const w = 8, h = 8, c = new Uint32Array(w * h * NF), put = (i, oc, iters, creep, jumps, skip) => { const o = i * NF; c[o] = oc; c[o + 1] = iters; c[o + 2] = creep; c[o + 3] = jumps; c[o + 4] = skip; };
    put(0, 1, 10, 1, 2, 5); put(1, 1, 20, 3, 4, 7); put(2, 2, 100, 0, 6, 9); put(3, 3, 999, 99, 99, 99); put(4, 4, 7, 7, 7, 7);
    const vb = createVolBreakdown(); expect(vb.addProbe('whole', c, w, h)).toBe(true);
    const bo = vb.summary().probes.whole.byOutcome;
    expect(bo.hit).toMatchObject({ px: 2, jumps: 3, creep: 2, skip: 6 }); expect(bo.hit.steps).toEqual({ mean: 15, p95: 20 });
    expect(bo.pass).toMatchObject({ px: 1, jumps: 6, creep: 0, skip: 9 }); expect(bo.pass.steps).toEqual({ mean: 100, p95: 100 });
    const t = vb.lines(), i = t.findIndex(l => l.startsWith('probe whole: windows 1'));
    expect(t[i + 1]).toBe('probe whole by outcome: hit steps mean/p95 15.0/20 · jumps 3.0 · creep 2.0 · skipTex 6.0 | pass steps mean/p95 100.0/100 · jumps 6.0 · creep 0.0 · skipTex 9.0');
    expect(t[i + 3]).toMatch(/^probe native: /);
    // no pass pixel: "-" for it; no probe at all: the line says so (no NaN)
    const c2 = new Uint32Array(64 * 64 * NF); c2[0] = 1; c2[1] = 4;
    const v2 = createVolBreakdown(); v2.addProbe('whole', c2, 64, 64); expect(v2.lines().some(l => l.endsWith('| pass -'))).toBe(true);
    const l0 = createVolBreakdown().lines().join('\n'); expect(l0).toContain('probe whole by outcome: - (no probe read back)'); expect(l0).not.toMatch(/NaN|undefined/);
  });
  it('probe approach: per outcome and per R (4 / 8 / 16) the mean steps / jumps to the first sample within R over the rays that came within it, and the share of the pass rays that never did; the line follows the by-outcome line', () => {
    expect(BD_NEAR_R).toEqual([4, 8, 16]);
    const w = 8, h = 8, c = new Uint32Array(w * h * NF), at = n => 8 + 2 * n, put = (i, oc, near) => { const o = i * NF; c[o] = oc; c[o + 1] = 30; near.forEach((x, k) => { if (x) { c[o + at(k)] = x[0]; c[o + at(k) + 1] = x[1]; } }); };
    put(0, 1, [[3, 1], [2, 0], [1, 0]]); put(1, 1, [[5, 3], [4, 2], [2, 1]]); // hits: R=4: 4/2 steps/jumps, R=8: 3/1, R=16: 1.5/0.5
    put(2, 2, [[10, 4], [6, 3], [4, 2]]); put(3, 2, [null, [8, 4], [4, 2]]); put(4, 2, [null, null, [6, 3]]); put(5, 2, [null, null, null]); // pass: R=4 one of four reached (10/4, never 75 %), R=8 two (7/3.5, never 50 %), R=16 three (4.67/2.33, never 25 %)
    put(6, 3, [[99, 99], [99, 99], [99, 99]]); // other outcomes are left out
    const vb = createVolBreakdown(); expect(vb.addProbe('whole', c, w, h)).toBe(true);
    const bo = vb.summary().probes.whole.byOutcome;
    expect(bo.hit.near.map(x => [x.R, x.reached, x.steps, x.jumps, x.never])).toEqual([[4, 2, 4, 2, 0], [8, 2, 3, 1, 0], [16, 2, 1.5, 0.5, 0]]);
    expect(bo.pass.near.map(x => [x.R, x.reached, x.never])).toEqual([[4, 1, 0.75], [8, 2, 0.5], [16, 3, 0.25]]);
    expect(bo.pass.near[0]).toMatchObject({ steps: 10, jumps: 4 }); expect(bo.pass.near[1]).toMatchObject({ steps: 7, jumps: 3.5 }); expect(bo.pass.near[2].steps).toBeCloseTo(14 / 3); expect(bo.pass.near[2].jumps).toBeCloseTo(7 / 3);
    const t = vb.lines(), i = t.findIndex(l => l.startsWith('probe whole by outcome:'));
    expect(t[i + 1]).toBe('probe approach (steps/jumps to the first sample within R voxels of a surface): R=4 hit steps/jumps 4.0/2.0 pass 10.0/4.0 never 75% | R=8 hit steps/jumps 3.0/1.0 pass 7.0/3.5 never 50% | R=16 hit steps/jumps 1.5/0.5 pass 4.7/2.3 never 25%');
    expect(t[i + 2]).toMatch(/^probe native: /);
    // two windows add up; no pass pixel and no probe: "-" (no NaN)
    vb.addProbe('whole', c, w, h); expect(vb.summary().probes.whole.byOutcome.pass.near[0]).toMatchObject({ reached: 2, never: 0.75 }); // the share stays the same, the sums double
    const c2 = new Uint32Array(64 * 64 * NF); c2[0] = 1; c2[1] = 4; c2[8] = 2; c2[9] = 1; const v2 = createVolBreakdown(); v2.addProbe('whole', c2, 64, 64);
    expect(v2.lines().find(l => l.startsWith('probe approach'))).toBe('probe approach (steps/jumps to the first sample within R voxels of a surface): R=4 hit steps/jumps 2.0/1.0 pass - never - | R=8 hit steps/jumps - pass - never - | R=16 hit steps/jumps - pass - never -');
    const l0 = createVolBreakdown().lines().join('\n'); expect(l0).toContain('probe approach (steps/jumps to the first sample within R voxels of a surface): - (no probe read back)'); expect(l0).not.toMatch(/NaN|undefined/);
  });
  it('the report notes say what the approach counts mean (English, no filter by the menu)', () => {
    const log = createPerfLog({ kind: 'webgpu', now: () => 0, store: null }); log.vb = createVolBreakdown(); log.vb.seconds = 1;
    const t = perfReport(log, {}); expect(t).toMatch(/note: probe approach = [^\n]*first sample with a surface distance <= R voxels[^\n]*never = the share of the pass rays/); expect(t).toMatch(/upper bound of what starting the ray near the surface/);
    expect(t).toMatch(/note: ratio = [^\n]*withCreep turns it on \(useSkip 1 over the display's 0\)[^\n]*negative est of withCreep = the ms the creep skip adds/);
  });
  it('an uncovered pixel (outcome 0) is no pixel; a bad kind or a short array is refused; the rows of WebGL line up with the heading with the rec column "-"', () => {
    const vb = createVolBreakdown(); expect(vb.addProbe('whole', new Uint32Array(64 * 64 * NF), 64, 64)).toBe(true); expect(vb.summary().probes.whole).toBeNull();
    expect(vb.addProbe('x', new Uint32Array(8), 1, 1)).toBe(false); expect(vb.addProbe('whole', new Uint32Array(8), 64, 64)).toBe(false);
    const log = createPerfLog({ kind: 'webgl', now: () => 1000, store: null }); log.row({ menu: 0, fps: 72 }, 1000);
    const t = perfReport(log, {}).split('\n'), h = t.findIndex(l => /^\s*t\s+fps\s+g1/.test(l));
    expect(t[h]).toMatch(/fov\s+rec\s+hold\s+mv\s+mvr\s+imax\s+mk\s+slotc\s+perc\s+hset\s+hk\s+gfix\s+mlow\s+tab\s+fmin\s+favg\s+late\s+ip95\s+lpx$/); expect(t[h + 1].length).toBe(t[h].length); expect(t[h + 1]).toMatch(/\s-$/); expect(t.join('\n')).not.toContain('-- vol breakdown');
  });
  it('the table of variants: the ten (and the march variants of vr-wgpu-coarse-march.js and the coarse-grid pre-pass variants of vr-wgpu-coarse-proxy.js, then the compute-march variants after them), in the order they run, with the program / uniform change each needs (noJump leaves the pre-pass out too: it needs the jumps; noProxy only the pre-pass, and its turn runs the proxy comparison)', () => {
    { const ten = ['same', 'box', 'simple', 'noGrad', 'specCfg', 'noRefine', 'noShade', 'withCreep', 'noJump', 'noProxy']; expect(BD_VARIANTS.filter(v => ten.includes(v))).toEqual(ten); const march = ['distSplit', 'march2', 'march2c4']; expect(BD_VARIANTS.filter(v => march.includes(v))).toEqual(march); expect(BD_VARIANTS.indexOf('distSplit')).toBeGreaterThan(BD_VARIANTS.indexOf('noProxy')); const coarse = ['proxyTB', 'proxyCoarse8', 'proxyCoarse']; expect(BD_VARIANTS.filter(v => coarse.includes(v))).toEqual(coarse); /* (the coarse-grid pre-pass variants: tests/unit/vr-wgpu-coarse-proxy.test.js) */ const cs = ['cs', 'csHit', 'csWave', 'csTile', 'csShare', 'csTileSg', 'csShareSg']; expect(BD_VARIANTS.filter(v => cs.includes(v))).toEqual(cs); /* (the compute-march variants: tests/unit/vr-wgsl-cs.test.js) */ } expect(BD_SPECS.specCfg.spec).toBe(true); expect(BD_SPECS.specCfg.overrides).toBeUndefined(); // (A4: the program of the display built with the settings as pipeline constants; tests/unit/vr-wgsl-spec.test.js)
    expect(BD_SPECS.box.overrides).toEqual({ diag: 1 }); expect(BD_SPECS.simple.overrides).toEqual({ diag: 3 }); expect(BD_SPECS.withCreep.overrides).toEqual({ useSkip: 1 }); expect(BD_SPECS.noJump.overrides).toEqual({ jumpOn: 0, proxyOn: 0 }); expect(BD_SPECS.noProxy.overrides).toEqual({ proxyOn: 0 }); expect(BD_SPECS.noProxy.proxy).toBe(true); expect(BD_SPECS.noProxy.abl).toBeUndefined();
    expect([BD_SPECS.noGrad.abl, BD_SPECS.noRefine.abl, BD_SPECS.noShade.abl]).toEqual(['grad', 'refine', 'shade']); expect(BD_SPECS.same.abl).toBeUndefined(); expect(BD_SPECS.same.overrides).toBeUndefined();
  });
});

describe('the collector: the steps of a ray in four places (to tA / approach / near / tail), the probe with and without the pre-pass', () => {
  const F = Object.fromEntries(BD_PROBE_FIELDS.map((k, i) => [k, i]));
  // one pixel: outcome, steps, the pre-pass's start count A, and per R (4, 8, 16) the first / last sample within R (0 = none)
  const px = (c, i, { oc, I, A = 0, first = [0, 0, 0], last = [0, 0, 0] }) => { const o = i * NF; c[o + F.outcome] = oc; c[o + F.iters] = I; c[o + F.toTA] = A; [4, 8, 16].forEach((R, j) => { c[o + F['near' + R + 'Steps']] = first[j]; c[o + F['last' + R + 'Steps']] = last[j]; }); };
  const win = (rays, n = 64) => { const c = new Uint32Array(n * NF); rays.forEach((r, i) => px(c, i, r)); return c; }; // n pixels (the window's 8 x 8 here, 64 x 64 = 4096 where the host's own size is meant)
  const sum4 = o => o.toTA + o.approach + o.near + o.tail;
  it('the five places a ray can lie in: all before the start, a near stretch before the start, the usual one, a ray that never came near, one that ended near', () => {
    const vb = createVolBreakdown();
    // hit rays (each alone in its window): [I, A, first, last] -> toTA / approach / near / tail
    const cases = [
      [{ oc: 1, I: 20, A: 5, first: [9, 9, 9], last: [20, 20, 20] }, [5, 3, 12, 0]], // after the start: approach 9 - 1 - 5, near 20 - 9 + 1
      [{ oc: 1, I: 25, A: 10, first: [4, 4, 4], last: [15, 15, 15] }, [10, 0, 5, 10]], // the first near sample lay before the start: near counts from the start
      [{ oc: 1, I: 12, A: 12, first: [2, 2, 2], last: [3, 3, 3] }, [12, 0, 0, 0]], // everything before the start (an empty ray in the run without the pre-pass)
      [{ oc: 1, I: 7, A: 2 }, [2, 5, 0, 0]], // never within R: all steps after the start are approach
      [{ oc: 1, I: 30, A: 0, first: [10, 10, 10], last: [18, 18, 18] }, [0, 9, 9, 12]],
    ];
    for (const [ray, want] of cases) {
      const v = createVolBreakdown(); expect(v.addProbe('whole', win([ray]), 8, 8)).toBe(true);
      const hit = v.summary().splits.off.whole[0].hit; expect([hit.toTA, hit.approach, hit.near, hit.tail]).toEqual(want); expect(sum4(hit)).toBe(ray.I); expect(hit.n).toBe(1); expect(hit.never).toBe(ray.first?.[0] ? 0 : 1);
    }
    expect(vb.summary().splits.off.whole).toBeNull(); // no window: no split
  });
  it('the four places add up to the steps of every covered hit / pass ray, per R, and a mixed window is averaged per outcome (accstop and discard are left out)', () => {
    const rays = []; let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 64; i++) { const I = 1 + rnd(200), A = rnd(I + 1), f = [0, 0, 0], l = [0, 0, 0]; for (let j = 0; j < 3; j++) if (rnd(3)) { f[j] = 1 + rnd(I); l[j] = f[j] + rnd(I - f[j] + 1); } rays.push({ oc: 1 + (i & 1) + (i % 7 === 0 ? 2 : 0), I, A, first: f, last: l }); }
    const vb = createVolBreakdown(); vb.addProbe('native', win(rays), 8, 8);
    const sp = vb.summary().splits.off.native;
    for (const x of sp) for (const k of ['hit', 'pass']) { const o = x[k]; const mine = rays.filter(r => r.oc === (k === 'hit' ? 1 : 2)); expect(o.n).toBe(mine.length); expect(sum4(o)).toBeCloseTo(mine.reduce((a, r) => a + r.I, 0) / mine.length, 9); }
  });
  it('the run with the display\'s tiles comes through add(probeOn:<kind>) into its own aggregate; the run without stays the probe of before (probes.whole, the lines of the probe), the on run starts at the pre-pass\'s start (to tA 0)', () => {
    const vb = createVolBreakdown();
    expect(vb.add('probeOn:whole', win([{ oc: 1, I: 14, A: 0, first: [3, 3, 3], last: [14, 14, 14] }], 4096), 64)).toBe(true); // (name, counters, 64: the host's own call)
    expect(vb.add('probeOn:bogus', win([], 4096), 64)).toBe(false);
    vb.addProbe('whole', win([{ oc: 1, I: 20, A: 6, first: [9, 9, 9], last: [20, 20, 20] }]), 8, 8);
    const s = vb.summary(), on = s.splits.on.whole[0].hit, off = s.splits.off.whole[0].hit;
    expect([on.toTA, on.approach, on.near, on.tail]).toEqual([0, 2, 12, 0]); expect([off.toTA, off.approach, off.near, off.tail]).toEqual([6, 2, 12, 0]);
    expect(s.probes.whole.windows).toBe(1); expect(s.probes.whole.steps.mean).toBe(20); expect(s.probesOn.whole.windows).toBe(1); expect(s.probesOn.whole.steps.mean).toBe(14);
    const t = vb.lines(), at = k => t.find(l => l.startsWith(k));
    expect(at('probe whole: windows 1')).toMatch(/steps mean\/p50\/p95\/max 20\.0\/20\/20\/20/); // the existing line: the run without
    expect(at('probe split whole off (steps per ray: to tA / approach / near / tail): R=4 hit 6.0/2.0/12.0/0.0 (n 1, never 0%) | pass -')).toBeTruthy();
    expect(at('probe split whole on (the same, with the display\'s tiles): R=4 hit 0.0/2.0/12.0/0.0 (n 1, never 0%) | pass -')).toBeTruthy();
    expect(at('probe split native off')).toMatch(/- \(no window\)$/);
    expect(at('probe steps per ray, hit | pass: whole off 20.0 | - (windows 1) · whole on 14.0 | - (windows 1)')).toBeTruthy();
  });
  it('the notes say what the places mean and what the diff lines are (English)', () => {
    const log = createPerfLog({ kind: 'webgpu', hz: 72 }); log.vb = createVolBreakdown(); log.vb.seconds = 1;
    const t = perfReport(log, {}).split('\n'), notes = t.filter(l => l.startsWith('note: ')).join('\n');
    expect(notes).toMatch(/probe split = the steps \(loop iterations\) of a ray in four places/); expect(notes).toMatch(/to tA = the iterations before the start the pre-pass gives the ray/); expect(notes).toMatch(/The tail of the pass rays is what stopping a ray early/);
    expect(notes).toMatch(/diff px <variant>/); expect(notes).toMatch(/max colour channel diff/); expect(notes).not.toMatch(/[぀-ヿ一-鿿]/);
  });
});

describe('the table of variants: one place to add one (defineBdVariant), the pixel comparison of any variant', () => {
  const withVariant = (spec, fn) => { defineBdVariant(spec); try { fn(); } finally { delete BD_SPECS[spec.name]; BD_VARIANTS.splice(BD_VARIANTS.indexOf(spec.name), 1); } };
  it('a defined variant is in BD_VARIANTS (the order it was defined in) and BD_SPECS, appears in the report as an "abl" line and in the collector; a name is defined once; the nine stay as they were', () => {
    const nine = ['same', 'box', 'simple', 'noGrad', 'noRefine', 'noShade', 'withCreep', 'noJump', 'noProxy'], before = BD_VARIANTS.length;
    expect(BD_VARIANTS.filter(v => nine.includes(v))).toEqual(nine); // (the nine are in this order; the variants of the other groups are registered between them by their own defineBdVariant calls)
    withVariant({ name: 'spec', abl: 'grad', diff: true }, () => {
      expect(BD_VARIANTS.at(-1)).toBe('spec'); expect(BD_SPECS.spec).toEqual({ name: 'spec', abl: 'grad', diff: true });
      expect(() => defineBdVariant({ name: 'spec' })).toThrow(/already defined/); expect(() => defineBdVariant({})).toThrow();
      const vb = createVolBreakdown(); expect(vb.add('spec', 4, 5)).toBe(true); expect(vb.summary().variants.spec.n).toBe(1); expect(vb.lines().some(l => l.startsWith('abl spec n=1 '))).toBe(true);
    });
    expect(BD_VARIANTS).toHaveLength(before); expect(BD_SPECS.spec).toBeUndefined();
    expect(BD_SPECS.noProxy.diff).toBe(true); expect(BD_SPECS.noJump.diff).toBeUndefined(); expect(BD_SPECS.same.diff).toBeUndefined();
  });
  it('a diff variant counts comparisons: max pixels of one, pixels compared, comparisons with a differing pixel, the largest colour channel and depth byte difference; the line says so', () => {
    withVariant({ name: 'coarse', abl: 'grad', diff: true }, () => {
      const vb = createVolBreakdown();
      expect(vb.summary().diffs.coarse).toEqual({ comparisons: 0, withDifference: 0, maxDiffPx: 0, pixels: 0, maxColorDiff: 0, maxDepthByteDiff: 0, maxColorPx: 0 });
      expect(vb.lines().find(l => l.startsWith('diff px coarse: '))).toBe('diff px coarse: - (no comparison made: the variant had no pass in a frame, or no read-back)');
      for (const [n, tot] of [[0, 1000], [12, 1000], [0, 900]]) expect(vb.add('diff:coarse', n, tot)).toBe(true);
      expect(vb.add('diffMax:coarse', 3, 40)).toBe(true); expect(vb.add('diffMax:coarse', 1, 80)).toBe(true); expect(vb.add('diffColor:coarse', 5, 1)).toBe(true); expect(vb.add('diffColor:coarse', 2, 1)).toBe(true);
      expect(vb.summary().diffs.coarse).toEqual({ comparisons: 3, withDifference: 1, maxDiffPx: 12, pixels: 1000, maxColorDiff: 3, maxDepthByteDiff: 80, maxColorPx: 5 });
      expect(vb.lines().find(l => l.startsWith('diff px coarse: '))).toBe('diff px coarse: max 12 of 1000 px · 1 of 3 comparisons had a differing pixel · max colour channel diff 3 of 255 · max packed depth byte diff 80 of 255 · colour differs in up to 5 px');
      expect(vb.add('diff:nobody', 1, 1)).toBe(false); expect(vb.add('diff:same', 1, 1)).toBe(false); expect(vb.add('diff:coarse', -1, 10)).toBe(false); expect(vb.add('diff:coarse', 1, 0)).toBe(false); expect(vb.add('diffMax:same', 1, 1)).toBe(false);
    });
  });
  it('noProxy: the proxy diff line and the summary of before come out in the same form (proxyDiff is its own count; the new numbers are in the diff px line)', () => {
    const vb = createVolBreakdown();
    expect(vb.lines().find(l => l.startsWith('proxy diff px: '))).toBe('proxy diff px: - (no comparison made: the low pass did not use the pre-pass, or no read-back) · pre-pass compute median -');
    for (const [n, tot] of [[0, 640], [0, 640], [3, 700]]) vb.add('proxyDiff', n, tot);
    vb.add('diffMax:noProxy', 2, 7); vb.add('proxyMs', 0.8, 1);
    expect(vb.summary().proxy).toEqual({ comparisons: 3, withDifference: 1, maxDiffPx: 3, pixels: 700, computeMs: 0.8, computeN: 1 });
    expect(vb.lines().find(l => l.startsWith('proxy diff px: '))).toBe('proxy diff px: max 3 of 700 px · 1 of 3 comparisons had a differing pixel · pre-pass compute median 0.80 ms (1)');
    expect(vb.lines().find(l => l.startsWith('diff px noProxy: '))).toBe('diff px noProxy: max 3 of 700 px · 1 of 3 comparisons had a differing pixel · max colour channel diff 2 of 255 · max packed depth byte diff 7 of 255 · colour differs in up to 0 px');
  });
});

// ---- the host, driven with a mock device ----
const GPU_GLOBALS = () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
};
const withGpu = fn => async () => { GPU_GLOBALS(); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
// a device with timestamp-query: script = [[begin, end] ns ticks, ...] in the order the resolves are encoded (low pass, marker, shadow, ...); the log keeps the passes and the commands in the order of encoding
const mockGpu = (script, { timestamps = true } = {}) => {
  const log = { passes: [], cmds: [], buffers: [], textures: [], writes: [], queries: 0, shaders: [], pipelines: [], bindGroups: [], layouts: 0, computePipelines: [], computePasses: [] };
  const device = { features: new Set(timestamps ? ['timestamp-query'] : []), limits: {} };
  device.queue = { writeBuffer: (b, off, data) => { log.writes.push({ b, data: new Int32Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0)) }); }, writeTexture() {}, submit: l => { log.cmds.push('submit'); } };
  device.createQuerySet = d => { log.queries++; return { d, destroy() {} }; };
  device.createBuffer = d => { const b = { d, vals: [0n, 0n], destroyed: false, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => (d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array(b.vals).buffer), unmap() {} }; log.buffers.push(b); return b; };
  device.createTexture = d => { const t = { d, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({ t }) }; log.textures.push(t); return t; };
  device.createSampler = () => ({}); device.createBindGroupLayout = () => { log.layouts++; return {}; }; device.createPipelineLayout = () => ({});
  device.createShaderModule = d => { log.shaders.push(d.code); return {}; };
  device.createComputePipeline = d => { const p = { d, compute: true }; log.computePipelines.push(p); return p; }; device.createComputePipelineAsync = async d => device.createComputePipeline(d);
  device.createRenderPipeline = d => { const p = { d }; log.pipelines.push(p); return p; }; device.createRenderPipelineAsync = async d => { const p = { d }; log.pipelines.push(p); return p; };
  device.createBindGroup = d => { const g = { d }; log.bindGroups.push(g); return g; };
  device.createCommandEncoder = () => ({
    beginRenderPass: d => { const p = { d, pipeline: null, groups: {}, viewports: [], scissors: [], draws: 0 }; log.passes.push(p); log.cmds.push('pass'); return { setPipeline: x => { p.pipeline = x; }, setVertexBuffer() {}, setBindGroup: (i, g) => { p.groups[i] = g; }, setViewport: (...a) => p.viewports.push(a), setScissorRect: (...a) => p.scissors.push(a), draw: () => { p.draws++; }, end() {} }; },
    beginComputePass: d => { const p = { d, pipeline: null, groups: {}, dispatches: [], at: log.cmds.length }; log.computePasses.push(p); log.cmds.push('cpass'); return { setPipeline: x => { p.pipeline = x; }, setBindGroup: (i, g) => { p.groups[i] = g; }, dispatchWorkgroups: (...a) => p.dispatches.push(a), end() {} }; },
    resolveQuerySet() {}, copyBufferToTexture() {}, copyBufferToBuffer: (_s, _o, dst, _d, n) => { if (n === 16 && !(_s.d.usage & 64)) dst.vals = script.shift(); log.cmds.push('copyB' + n); }, clearBuffer: () => log.cmds.push('clear'), copyTextureToBuffer() {}, finish: () => ({}),
  });
  return { device, log };
};
const drawLow = (r, u = {}) => r.draw({ u, cams: [eyeCam(640, 480), eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false } });
let sharedTex = null; // one combined texture for every uniform set of this file (a renderer finds its textures on the GPU as a session does)
// distInCls 0: no jumps, the display's way is S (no pre-pass compute pass in the frame: the scripted timestamps of these tests are the low pass's and the shadow passes' alone)
const bdU = (over = {}) => {
  const tex = sharedTex ||= (() => { const t = new THREEG.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4), 4, 4, 4); t.format = THREEG.RGBAFormat; t.type = THREEG.UnsignedByteType; t.needsUpdate = true; return t; })();
  return { distInCls: { value: 0 }, useCls: { value: 1 }, diag: { value: 0 }, refine: { value: 1 }, planeCount: { value: 0 }, clsTex: { value: tex }, halfExt: { value: new THREEG.Vector3(1, 1, 1) }, voxelMin: { value: 0.02 }, clsChan: { value: new THREEG.Vector4(0, 1, -1, -1) },
    segA: { value: [0, 1, 2, 3].map(i => new THREEG.Vector4(0, 0, 1, i < 2 ? 1 : 0)) }, ...over };
};
const frame = (r, { u = bdU() } = {}) => { drawLow(r, u); return r.volume.markFrame(); };
const HOST_SKIP_ON = () => bdU({ useSkip: { value: 1 } }), HOST_SKIP_OFF = () => bdU({ useSkip: { value: 0 } }); // the session's uniforms: the host's own creep-skip switch (the bits describe the texture) on / off

describe('host: nothing is made for the breakdown until it is begun, and the display programs are the display text', () => {
  it('a drawn frame makes no breakdown resource (buffers, textures, queries, bind group layouts, pipelines): the count after drawing equals the count before the first frame is drawn', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    await r.preload(bdU(), [{ cls4: false, events: false }]); frame(r); frame(r); await settle(); // (the session start and the first frames make the display's ways' resources)
    const before = { b: log.buffers.length, q: log.queries, l: log.layouts };
    frame(r); frame(r); await settle();
    expect(log.buffers).toHaveLength(before.b); expect(log.queries).toBe(before.q); expect(log.layouts).toBe(before.l);
    expect(log.shaders).toContain(volumeWgsl({ f16: false, cls4: false, events: false })); expect(log.shaders.filter(c => /abl=|counters|march2/.test(c.split('\n')[0]))).toEqual([]); // (the display's program and its ways: no breakdown variant)
    expect(r.volume.bdActive()).toBe(false);
    r.dispose();
  }));
  it('warm() makes only the display variants it is asked for (same keys as before), pipeFor of one gives the same program again', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    await r.volume.warm(); expect(log.pipelines.length).toBeGreaterThanOrEqual(2); expect(log.shaders.slice(0, 3)).toEqual([volumeWgsl({ cls4: false, events: false }), volumeWgsl({ cls4: false, events: true }), proxyWgsl({ cls4: false })]); // the display's own programs first (the section-free variant's pre-pass only), then the ways' (docs/vr-wgpu-newpath.js)
    expect(log.computePipelines.length).toBeGreaterThanOrEqual(1);
    const n = log.pipelines.length; r.volume.pipeFor({ cls4: false, events: true }); r.volume.pipeFor({ cls4: false, events: false }); expect(log.pipelines).toHaveLength(n);
    r.dispose();
  }));
  it('the compiler messages of a breakdown variant have a key of their own in the diagnostics', async () => {
    const d = { values: {}, value(k, v) { this.values[k] = v; }, stage() {}, error() {} }; const mod = { getCompilationInfo: async () => ({ messages: [] }) };
    gxShaderInfo(d, mod, { f16: false, cls4: false, events: true }); gxShaderInfo(d, mod, { f16: false, cls4: false, events: true, abl: 'shade' }); gxShaderInfo(d, mod, { f16: false, cls4: false, events: true, counters: true });
    await settle(); expect(Object.keys(d.values)).toEqual(['wgsl c3e', 'wgsl c3e abl-shade', 'wgsl c3e counters']);
  });
});

describe('host: the shadow pass', () => {
  const begin = async (r, onShadow) => { const res = await r.breakdown.begin({ cls4: false, events: false }, onShadow); return res; };
  it('begin compiles the three abl variants and the counting variant asynchronously (not the display pipelines again) and reports what it has', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    const ns = log.shaders.length, np0 = log.pipelines.length, res = await begin(r, () => {});
    expect(res).toEqual({ shadow: true, probe: true, failed: [] });
    expect(log.shaders.slice(ns)).toHaveLength(8); // the three abl variants, the counting twin, the three march variants (vr-wgpu-coarse-march.js) and the proxy comparison's compute
    expect(log.shaders.slice(ns, ns + 3).map(t => /abl=(\w+) counters=false/.exec(t)[1])).toEqual(ABLATIONS); expect(log.shaders[ns + 3]).toContain('counters=true');
    expect(log.shaders.slice(ns)).toEqual([...ABLATIONS.map(abl => volumeWgsl({ events: false, abl })), volumeWgsl({ events: false, counters: true }), ...Object.keys(MARCH_VARIANTS).map(k => marchWgsl(volumeWgsl({ events: false }), k)), proxyDiffWgsl()]); expect(log.shaders.at(-1)).toBe(proxyDiffWgsl()); // (the comparison's compute is the last one made)
    expect(log.pipelines.length - np0).toBe(7); // no display pipeline among them (the session start made those)
    r.dispose();
  }));
  it('a variant that does not compile is left out and listed; without timestamp-query no shadow pass is made but the probe is still available', withGpu(async () => {
    const { device, log } = mockGpu([]); const real = device.createRenderPipelineAsync; let k = 0; device.createRenderPipelineAsync = async d => { if (++k === 2) throw new Error('compile error x'); return real(d); };
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; k = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    const res = await begin(r, () => {}); expect(res.shadow).toBe(false); expect(res.probe).toBe(true); expect(res.failed).toHaveLength(1); expect(res.failed[0]).toContain('compile error x');
    r.dispose();
    const g = mockGpu([], { timestamps: false }); const r2 = createVrVolumeRenderer({ THREE: THREEG, device: g.device, halfExt: [1, 1, 1] });
    const res2 = await begin(r2, () => {}); expect(res2.shadow).toBe(false); expect(res2.probe).toBe(true);
    const rec = frame(r2); expect(r2.breakdown.shadow(rec, BD_SPECS.same)).toBe(false); r2.dispose();
  }));
  it('the shadow pass comes after the marker pass, draws the low pass again (same viewports and scissors) into targets of its own with its own timestamps and uniform slots; its ms is paired with the same frame\'s low pass ms and is not in the vol, span or gap numbers', withGpu(async () => {
    // order of the resolves: low pass of frame 1, its marker, its shadow, low pass of frame 2, its marker
    const { device, log } = mockGpu([[10_000_000n, 20_000_000n], [20_100_000n, 20_200_000n], [30_000_000n, 34_000_000n], [50_000_000n, 60_000_000n], [60_100_000n, 60_200_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    const got = []; await begin(r, (n, s, l) => got.push([n, s, l]));
    const rec1 = frame(r); // frame 1
    expect(log.passes.map(p => p.d.colorAttachments?.length)).toEqual([2, 1]); // low (2 targets), marker
    const used = log.passes.length;
    expect(r.breakdown.shadow(rec1, BD_SPECS.noGrad)).toBe(true);
    const low = log.passes[0], marker = log.passes[1], sh = log.passes[used];
    expect(log.passes.indexOf(sh)).toBeGreaterThan(log.passes.indexOf(marker)); // after markFrame
    expect(sh.viewports).toEqual(low.viewports); expect(sh.scissors).toEqual(low.scissors); expect(sh.draws).toBe(low.draws);
    expect(sh.pipeline).not.toBe(low.pipeline);
    expect(sh.d.timestampWrites.querySet).not.toBe(low.d.timestampWrites.querySet);
    expect(sh.d.colorAttachments.map(a => a.storeOp)).toEqual(['store', 'store']); expect(sh.d.colorAttachments.map(a => a.loadOp)).toEqual(['clear', 'clear']);
    expect(sh.d.colorAttachments[0].view.t).not.toBe(low.d.colorAttachments[0].view.t); expect(sh.d.colorAttachments[1].view.t).not.toBe(low.d.colorAttachments[1].view.t);
    expect(sh.d.colorAttachments[0].view.t.d.size).toEqual(low.d.colorAttachments[0].view.t.d.size); // exactly the low target's size
    expect(sh.groups[0]).not.toBe(low.groups[0]); // its own uniform slot (bind group on the buffers 4 / 5)
    await settle();
    const pairs = got.filter(x => x[0] !== 'proxyMs'); expect(pairs).toHaveLength(1); expect(pairs[0][0]).toBe('noGrad'); expect(pairs[0][1]).toBeCloseTo(4); expect(pairs[0][2]).toBeCloseTo(10); // (the display's own pre-pass ms is told too: proxyMs)
    const rec2 = frame(r); await settle();
    const gm = r.volume.takeGpuMs(); expect(gm.n).toBe(2); expect(gm.ms).toBeCloseTo(20); // the vol numbers: the two low passes only
    const st = r.volume.takeFrameStats();
    expect(st.spans.map(x => +x.toFixed(3))).toEqual([10.2, 10.2]); expect(st.gaps).toEqual([]); // the frame after the shadow pass has no gap sample
    expect(rec2.vms).toBeCloseTo(10); expect(rec1.vms).toBeCloseTo(10); expect(rec1.vols).toBe(1); expect(rec1.lowMs).toBeCloseTo(10);
    r.dispose();
  }));
  it('the pair completes whichever read-back comes first, and a failed low pass makes no pair; the overrides of a variant are in the uniforms of the shadow pass, not in the low pass\'s', withGpu(async () => {
    const { device, log } = mockGpu([[10_000_000n, 20_000_000n], [20_100_000n, 20_200_000n], [30_000_000n, 36_000_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    const got = []; await begin(r, (n, s, l) => got.push([n, s, l]));
    const rec = frame(r); const nWrites = log.writes.length;
    expect(r.breakdown.shadow(rec, BD_SPECS.box)).toBe(true);
    const diag = uniformLayout().fields.find(f => f.name === 'diag').offset / 4;
    const w = log.writes.slice(nWrites).filter(x => x.data.length === uniformLayout().byteSize / 4); expect(w).toHaveLength(2); expect(w.map(x => x.data[diag])).toEqual([1, 1]);
    expect(log.writes.slice(0, nWrites).filter(x => x.data.length === uniformLayout().byteSize / 4).map(x => x.data[diag])).toEqual([0, 0]);
    await settle(); expect(got.filter(x => x[0] !== 'proxyMs')).toEqual([['box', 6, 10]]);
    r.dispose();
    const g2 = mockGpu([[0n, 0n], [20_100_000n, 20_200_000n], [30_000_000n, 36_000_000n]]); const r2 = createVrVolumeRenderer({ THREE: THREEG, device: g2.device, halfExt: [1, 1, 1] }); const got2 = []; await begin(r2, (...a) => got2.push(a));
    const rec2 = frame(r2); r2.breakdown.shadow(rec2, BD_SPECS.same); await settle(); expect(got2).toEqual([]); r2.dispose();
  }));
  it('the display passes of this renderer run with useSkip 0 whatever the host\'s switch is (the creep skip is cut; the output is the same, see vr-skip-occupancy.js); withCreep turns it on over that, only while the host\'s bits are valid', withGpu(async () => {
    const { device, log } = mockGpu([[10_000_000n, 20_000_000n], [20_100_000n, 20_200_000n], [30_000_000n, 36_000_000n], [40_000_000n, 50_000_000n], [50_100_000n, 50_200_000n], [60_000_000n, 66_000_000n], [70_000_000n, 76_000_000n], [80_000_000n, 86_000_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    const got = []; await begin(r, (n, s, l) => got.push([n, s, l]));
    const sk = uniformLayout().fields.find(f => f.name === 'useSkip').offset / 4, isU = w => w.data.length === uniformLayout().byteSize / 4;
    // the host's switch is on: the low pass still gets 0, the shadow of 'same' 0, withCreep 1
    let n0 = log.writes.length; const rec = frame(r, { u: HOST_SKIP_ON() });
    expect(log.writes.slice(n0).filter(isU).map(w => w.data[sk])).toEqual([0, 0]);
    n0 = log.writes.length; expect(r.breakdown.shadow(rec, BD_SPECS.same)).toBe(true); expect(log.writes.slice(n0).filter(isU).map(w => w.data[sk])).toEqual([0, 0]);
    n0 = log.writes.length; expect(r.breakdown.shadow(rec, BD_SPECS.withCreep)).toBe(true); expect(log.writes.slice(n0).filter(isU).map(w => w.data[sk])).toEqual([1, 1]);
    // the host's switch is off (the bits are not valid): the display is the same, withCreep has no program for this frame (null: stepped past), no pass is made for it
    n0 = log.writes.length; const rec2 = frame(r, { u: HOST_SKIP_OFF() });
    expect(log.writes.slice(n0).filter(isU).map(w => w.data[sk])).toEqual([0, 0]);
    const np = log.passes.length; expect(r.breakdown.shadow(rec2, BD_SPECS.withCreep)).toBeNull(); expect(log.passes.length).toBe(np);
    expect(r.breakdown.shadow(rec2, BD_SPECS.same)).toBe(true);
    r.dispose();
  }));
  it('diag 4 (the host\'s own off switch for the creep skip) keeps withCreep out as well', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */ await begin(r, () => {});
    const rec = frame(r, { u: { useSkip: { value: 1 }, diag: { value: 4 } } }); expect(r.breakdown.shadow(rec, BD_SPECS.withCreep)).toBeNull();
    r.dispose();
  }));
  it('no free timer slot, an unknown record or a frame without a snapshot: nothing is submitted (the caller does not advance its variant)', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n], [5n, 6n], [7n, 8n], [9n, 10n], [11n, 12n], [13n, 14n], [15n, 16n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    expect(r.breakdown.shadow({}, BD_SPECS.same)).toBe(false); // not begun
    await begin(r, () => {});
    expect(r.breakdown.shadow({}, BD_SPECS.same)).toBe(false); // a record that is not the snapshot's
    const rec = frame(r); const n = log.passes.length;
    for (let i = 0; i < 4; i++) expect(r.breakdown.shadow(rec, BD_SPECS.same)).toBe(true); // 4 slots busy: the mock's maps resolve later
    expect(r.breakdown.shadow(rec, BD_SPECS.same)).toBe(false); expect(log.passes.length).toBe(n + 4);
    r.dispose();
  }));
  it('a variant that has no program is stepped past (null), a busy timer is retried (false): the rotation of the view never stalls on a variant that failed to compile', withGpu(async () => {
    const { device, log } = mockGpu(Array.from({ length: 40 }, (_, i) => [BigInt(1000 * i + 1), BigInt(1000 * i + 500)]));
    const real = device.createRenderPipelineAsync; let k = 0; device.createRenderPipelineAsync = async d => { if (++k === 2) throw new Error('refine did not compile'); return real(d); };
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; k = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    const got = []; const res = await begin(r, (n, s, l) => got.push(n)); expect(res.failed).toHaveLength(1);
    let vi = 0; const results = [];
    for (let i = 0; i < 30; i++) { // the view's rule: step on unless 'not now' (false)
      const rec = frame(r, { u: HOST_SKIP_ON() }); const spec = BD_SPECS[BD_VARIANTS[vi % BD_VARIANTS.length]]; const x = r.breakdown.shadow(rec, spec); results.push([spec.name, x]); if (x !== false) vi++; await settle();
    }
    expect(results.find(([n]) => n === 'noRefine')[1]).toBeNull();
    for (const n of ['withCreep', 'noJump', 'noGrad', 'noShade', 'same']) expect(got.includes(n), n).toBe(true);
    expect(got).not.toContain('noRefine');
    r.dispose();
  }));
  it('end() lets every resource of the recording go, drops the bind groups made on the shadow / probe buffers, and a second recording makes new ones', withGpu(async () => {
    const { device, log } = mockGpu(Array.from({ length: 8 }, (_, i) => [BigInt(i * 1000 + 1), BigInt(i * 1000 + 2)]));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    await begin(r, () => {}); const rec = frame(r); r.breakdown.shadow(rec, BD_SPECS.same); await settle();
    const nb = log.buffers.length;
    r.breakdown.end(); expect(r.volume.bdActive()).toBe(false);
    const alive = log.buffers.filter(b => !b.destroyed); // what stays: the session's own (box, uniform 0-3, query resolve, the slots)
    expect(log.buffers.length - alive.length).toBeGreaterThanOrEqual(2 + 4 + 2); // ubufs 4 / 5, query resolve, 4 slots, probe buffers
    const groupsBefore = log.bindGroups.length;
    await begin(r, () => {}); const rec2 = frame(r); r.breakdown.shadow(rec2, BD_SPECS.same);
    expect(log.bindGroups.length).toBeGreaterThan(groupsBefore); // the shadow bind groups were made again (not the destroyed ones from the cache)
    expect(nb).toBeGreaterThan(0); r.dispose();
  }));
  it('shadow pass code never touches the session\'s timer sums (static): no sumMs, vms, vols or vpend between the shadow and the probe functions', () => {
    const a = host.indexOf('const shadowPass ='), b = host.indexOf('const probeCounters ='); expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
    const body = host.slice(a, b); expect(body).not.toMatch(/sumMs|\.vms|vpend|volDone|ts\.count|\.vols\s*(\+\+|\+=)/);
    const c = host.indexOf('const bdSnapshot ='); expect(host.slice(c, a)).not.toMatch(/sumMs|\.vms|vpend/);
  });
});

describe('host: the counting probe', () => {
  it('a 64 x 64 pass with its own targets, buffer, uniform slot and bind group layout: the buffer is cleared before it and copied after it; the result is the u32 array; one at a time; not timed', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    await r.breakdown.begin({ cls4: false, events: false }, () => {}); r.breakdown.setProbeMode('off'); // (one run: without the pre-pass)
    frame(r); const nPass = log.passes.length, nCmd = log.cmds.length;
    const p1 = r.breakdown.probe({}, 'whole'), p2 = r.breakdown.probe({}, 'whole'); // the second: the first is still reading
    const [a, b] = await Promise.all([p1, p2]);
    expect(b).toBeNull(); expect(a.kind).toBe('whole'); expect(a.w).toBe(64); expect(a.counters).toBeInstanceOf(Uint32Array); expect(a.counters.length).toBe(64 * 64 * NF);
    const pass = log.passes[nPass]; expect(log.passes).toHaveLength(nPass + 1);
    expect(pass.viewports).toEqual([[0, 0, 64, 64, 0, 1]]); expect(pass.scissors).toEqual([[0, 0, 64, 64]]); expect(pass.d.timestampWrites).toBeUndefined();
    expect(pass.groups[1]).toBeTruthy(); expect(pass.groups[0]).toBeTruthy();
    const cmds = log.cmds.slice(nCmd); expect(cmds.indexOf('clear')).toBeLessThan(cmds.indexOf('pass')); expect(cmds.indexOf('pass')).toBeLessThan(cmds.indexOf('copyB' + 64 * 64 * NF * 4));
    expect(pass.d.colorAttachments[0].view.t.d.size).toEqual([64, 64, 1]);
    const again = await r.breakdown.probe({}, 'native'); expect(again.kind).toBe('native'); // free again after the read
    r.dispose();
  }));
  it('the native window is the centre of the left eye\'s region at the low pass\'s own pixel pitch (the region transform of the low pass), the whole window the eye\'s own matrix', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    await r.breakdown.begin({ cls4: false, events: false }, () => {});
    const cam = eyeCam(640, 480); r.draw({ u: {}, cams: [cam, eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false } });
    const mvpOf = w => new Float32Array(w.data.buffer, 0, 16);
    const nW = log.writes.length; await r.breakdown.probe({}, 'whole');
    const whole = log.writes.slice(nW).find(w => w.data.length === uniformLayout().byteSize / 4); const id = new THREEG.Matrix4().elements;
    expect(Array.from(mvpOf(whole))).toEqual(id);
    const nW2 = log.writes.length; await r.breakdown.probe({}, 'native');
    const nat = log.writes.slice(nW2).find(w => w.data.length === uniformLayout().byteSize / 4);
    // the low pass drew the whole 320 x 240 scaled image (no box given): a 64 x 64 window at (128, 88)
    const want = regionMvp(new THREEG.Matrix4(), new THREEG.Matrix4(), regionClip({ x0: 128, y0: 88, x1: 192, y1: 152 }, 320, 240)).elements;
    Array.from(mvpOf(nat)).forEach((v, i) => expect(v).toBeCloseTo(want[i], 5));
    r.dispose();
  }));
  it('without a begun breakdown (or a frame drawn since) the probe gives nothing', withGpu(async () => {
    const { device, log } = mockGpu([]); const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(bdU(), [{ cls4: false, events: false }]); log.computePasses?.splice(0); log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame */
    expect(await r.breakdown.probe({}, 'whole')).toBeNull(); r.dispose();
  }));
});

describe('WebGPU display: the creep skip is cut by the uniform, the text is untouched (static)', () => {
  it('passExtra gives useSkip 0 (a literal, not the session\'s value); the WebGL material and the WGSL text are not involved', () => {
    expect(host).toMatch(/const passExtra = u => \(\{ jumpOn: [^\n]*, useSkip: 0 \}\);/);
    expect(host).not.toMatch(/useSkip: \(u\.diag/);
    expect(volumeWgsl()).toContain('let skipOn=u.useSkip>0&&u.diag!=4;'); // the text still honours the uniform
    expect(vr).toContain('uniform int useSkip;'); expect(vr).toContain('u.useSkip.value=r?r.use:0;'); // the WebGL path and the host's switch are as before
  });
});

describe('vr-view.js wiring (static)', () => {
  const a = vr.indexOf(' const GX_REC_MS=30000;'), b = vr.indexOf(' const gxVolSubmitted=');
  const rec = vr.slice(a, b);
  it('the shadow pass is thrown after markFrame, in phase 1 of 4 frames; the probe in phase 3 (never in the shadow\'s frame) once a second, whichever way the menu is', () => {
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
    expect(vr.indexOf('frec=gx.vol?.volume.markFrame?.(gxMeasure()||ISO.state.span)')).toBeGreaterThan(0); // ISO.state.span: the comparison bench's frame marker (false by default)
    expect(vr.indexOf('gxRecFrame(frec,t1)')).toBeGreaterThan(vr.indexOf('frec=gx.vol?.volume.markFrame?.(gxMeasure()||ISO.state.span)'));
    expect(rec).toContain('const ph=gxS.rendered&3;'); expect(rec).toContain('if(ph===1){try{if(gx.vol.breakdown.shadow(frec,BD_SPECS[BD_VARIANTS[gxRec.vi%BD_VARIANTS.length]])!==false)gxRec.vi++}');
    expect(rec).toContain('else if(ph===3&&tn-gxRec.probeAt>=1000){'); expect(rec).not.toMatch(/ui\.open|ui\.tab/);
    expect(vr.indexOf('gxFrameEnd(fa0);\n  if(shotRequested')).toBeGreaterThan(0); // after the main render and the record's render line, as before
  });
  it('while it records: no swd, no vlat, no wake sample; rows carry rec 1 (WebGPU only); the first press only starts it; the benchmarks are not started with it and it does not start with them', () => {
    expect(vr).toContain('if(gxMeasure()&&!gxRec.on&&!gxSwdBusy&&(gxS.rendered&3)===2){'); expect(vr).toContain('if(gxMeasure()&&!gxRec.on&&!gxSwdBusy&&(gxS.rendered&3)===3){'); expect(vr).toContain('if(gxMeasure()&&!gxRec.on&&fa0-gxWakeAt<1000)');
    expect(vr).toContain('...(gx?{rec:(gxRec.on||gxRec.sec)?1:0,');
    expect(vr).toContain("if(!gx?.vol||!gx.ready||gxRec.phase!=='idle'||bench.active||anBench.active||cmpBench.active||identRun?.active||!mesh||!material)return;");
    expect(vr).toContain("const startAnBench=()=>{if(anBench.active||bench.active||cmpBench.active||identRun?.active||!mesh||gxRec.phase==='prep'||gxRec.on)return;"); expect(vr).toContain("if(bench.active||cmpBench.active||identRun?.active||!mesh||gxRec.phase==='prep'||gxRec.on)return;"); // the comparison bench (vr-bench.js) is one more thing they do not start inside
  });
  it('it does not write the diagnostics setting and leaves stage marks for its start and end; the 30 s run on the frame clock', () => {
    expect(rec).not.toContain('settings.diag'); expect(rec).not.toMatch(/saveSettings|applyQuality|setTimeout/);
    expect(rec).toContain("gxD.stage('breakdown start'"); expect(rec).toContain("gxD.stage('breakdown end'"); expect(rec).toContain('tn>=gxRec.until');
  });
  it('the button: detail tab only, WebGPU only, at y0+1020 (the rows above keep their places), ja / en texts for the three states', () => {
    expect(vr).toContain("btn(X,y0+1020,(MENU_W-2*X-40)/3,txt,ph!=='idle',()=>gxRecStart(),{size:28,disabled:ph!=='idle'})");
    const i = vr.indexOf("btn(X,y0+1020,(MENU_W-2*X-40)/3,txt"), s = vr.slice(vr.lastIndexOf('}else if(ui.tab===4){', i), i + 200);
    expect(s).toContain('if(gx){const ph=gxRec.phase');
    for (const t of ["'準備中'", "'Preparing'", "'記録中 残り'+sec+'秒'", "'Recording '+sec+' s left'", "'記録済み'", "'Recorded'", "'内訳を記録（30秒）'", "'Record breakdown (30 s)'"]) expect(s).toContain(t);
    for (const y of ['y0+200', 'y0+290', 'y0+380', 'y0+470', 'y0+560', 'y0+650', 'y0+740', 'y0+830']) expect(vr).toContain(y);
  });
  it('while it is prepared or records the auto quality does not move (the picture stays); a throw in it never stops the frame loop or the drawing', () => {
    expect(vr).toContain("autoFrames++;const nowA=performance.now();\n   if(gxRec.phase==='prep'||gxRec.on){autoFrames=0;heldWin=false;autoAt=nowA;ctrl.vol=ctrl.main=0;ctrlN.vol=ctrlN.main=0}");
    expect(vr).toContain("{try{gxRecFrame(frec,t1)}catch(e){console.warn('WebGPU breakdown:',e)}}");
    expect(host).toContain('try { volume.bdSnapshot(low.target, low.eyes, u, vr, bdPx); } catch (e) {');
  });
  it('the volume pass of the frame is called as before; the snapshot of the low pass is the renderer\'s (host), only while a recording runs', () => {
    expect(host).toContain("const lowDraw = volume.drawPass(low.target, low.eyes, u, vr, 0, null, null, dnp ? { proxy: low.px, np: { ...dnp, auto: true, pass: 'low', skip: '' } } : { proxy: low.px });"); // the new ways' option is added only while a display switch asks (dnp null: the call of before, character for character)
    expect(host).toContain('\n    if (volume.bdActive()) {');
    expect(host).toContain('for (const sc of e.scissors || [[e.x, e.y, e.w, e.h]]) { pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]); pass.draw(36); }');
    expect(host).toContain('const timed = (o?.timed ?? !overrides) && GX_SWITCH.timers;'); // GX_SWITCH.timers: the isolation run's switch (true by default)
    expect(vr).toContain('gx.vol.breakdown.begin(variant,'); expect(vr).toContain('if(gx){gxRec.gen++;gxRec.on=false;try{gx.vol?.dispose()}');
  });
});
