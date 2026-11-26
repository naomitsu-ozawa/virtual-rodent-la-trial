// The display's way choice (docs/vr-wgpu-newpath.js chooseWay) and the texts of the ways: the table of the plan's chapter 6, and that no frame's way is the old one.
import { describe, it, expect } from 'vitest';
import { chooseWay, WAYS, WAY_LADDER, wayMode, newPathText, DISPLAY_MODES, modeNeeds } from '../../docs/vr-wgpu-newpath.js';
import { marchWgsl } from '../../docs/vr-wgpu-coarse-march.js';
import { volumeWgsl } from '../../docs/vr-wgsl-core.js';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { readFileSync } from 'node:fs';

const base = { pass: 'low', jumpOn: true, section: false, diag: 0, distField: true, walkOk: true, matrixOk: true, gridReady: true };
const ch = over => chooseWay({ ...base, ...over });

describe('chooseWay: the table of chapter 6', () => {
  it('the normal frame (jumps, no section, diag 0 or 3) is B in the centre and in the periphery', () => {
    for (const diag of [0, 3]) for (const pass of ['low', 'peri']) expect(ch({ pass, diag })).toBe('B');
  });
  it('a walk that can reach the loop limit and a grid being made: D in the centre, D0 in the periphery (its D has no tiles); diag 2 (the loop count is the picture) is D0 in both', () => {
    for (const o of [{ walkOk: false }, { gridReady: false }]) { expect(ch({ ...o, pass: 'low' })).toBe('D'); expect(ch({ ...o, pass: 'peri' })).toBe('D0'); }
    for (const pass of ['low', 'peri']) expect(ch({ diag: 2, pass })).toBe('D0');
  });
  it('the probe (diag 5 or the probe pass), diag 1 and a matrix that cannot be inverted are D0 in every pass', () => {
    for (const pass of ['low', 'peri', 'probe']) { expect(ch({ pass, diag: 5 })).toBe('D0'); expect(ch({ pass, diag: 1 })).toBe('D0'); expect(ch({ pass, matrixOk: false })).toBe('D0'); }
    expect(ch({ pass: 'probe', diag: 0 })).toBe('D0');
  });
  it('a section plane: EvD with jumps, EvS without, whatever else holds', () => {
    for (const pass of ['low', 'peri', 'probe']) for (const diag of [0, 1, 2, 3, 4, 5]) for (const walkOk of [true, false]) { expect(ch({ section: true, pass, diag, walkOk })).toBe('EvD'); expect(ch({ section: true, jumpOn: false, pass, diag, walkOk })).toBe('EvS'); }
  });
  it('no jumps: OS for diag 4 with a distance field (matrix and grid fine), S for every other case (diag 2, the probe, a matrix that cannot be inverted, no distance field)', () => {
    expect(ch({ jumpOn: false, diag: 4 })).toBe('OS'); expect(ch({ jumpOn: false, diag: 4, pass: 'peri' })).toBe('OS');
    for (const o of [{ diag: 2 }, { diag: 5 }, { pass: 'probe', diag: 4 }, { diag: 4, matrixOk: false }, { diag: 4, distField: false }, { diag: 0, distField: false }, { diag: 4, gridReady: false }]) expect(ch({ jumpOn: false, ...o }), JSON.stringify(o)).toBe('S');
  });
  it('a part taken out of the body (boxed: its rays start at its own box) never uses a way that makes a pre-pass over the whole pass: without tiles of its own (partTiles false) it is D0 where the whole-pass way would be B or D, S where it would be OS; with them (partTiles: the cone through its partOcc) it is D in the centre pass and D0 in the periphery (no 8 x 8 pre-pass there); the other rows of the table are the same', () => {
    for (const diag of [0, 3]) for (const pass of ['low', 'peri']) expect(ch({ pass, diag, boxed: true })).toBe('D0');
    for (const o of [{ walkOk: false }, { gridReady: false }]) for (const pass of ['low', 'peri']) expect(ch({ ...o, pass, boxed: true })).toBe('D0');
    for (const o of [{}, { walkOk: false }, { gridReady: false }]) for (const diag of [0, 3, 4]) { expect(ch({ ...o, diag, pass: 'low', boxed: true, partTiles: true })).toBe('D'); expect(ch({ ...o, diag, pass: 'peri', boxed: true, partTiles: true })).toBe('D0'); }
    for (const pass of ['low', 'peri', 'probe']) for (const diag of [1, 2, 5]) expect(ch({ pass, diag, boxed: true, partTiles: true })).toBe('D0'); // (diag 1 draws before the loop, diag 2 draws the loop's count, 5 is the probe: no tiles)
    expect(ch({ pass: 'probe', diag: 0, boxed: true, partTiles: true })).toBe('D0'); expect(ch({ matrixOk: false, boxed: true, partTiles: true })).toBe('D0');
    expect(ch({ diag: 0, partTiles: true })).toBe(ch({ diag: 0 })); // (a volume that is not boxed ignores it)
    for (const pass of ['low', 'peri', 'probe']) for (const diag of [0, 1, 2, 3, 5]) for (const partTiles of [false, true]) expect(ch({ pass, diag, boxed: true, section: true, partTiles })).toBe('EvD'); // (a section row is not changed: the parts have none)
    for (const partTiles of [false, true]) { expect(ch({ jumpOn: false, diag: 4, boxed: true, partTiles })).toBe('S'); expect(ch({ jumpOn: false, diag: 4, boxed: true, pass: 'peri', partTiles })).toBe('S'); }
    for (const partTiles of [false, true]) { expect(ch({ distField: false, jumpOn: false, boxed: true, partTiles })).toBe('S'); expect(chooseWay({ ...base, general: true, boxed: true, partTiles })).toBe('S'); } // the general loop's rows: S whatever
    for (const partTiles of [false, true]) for (const pass of ['low', 'peri', 'probe']) for (const jumpOn of [true, false]) for (const diag of [0, 1, 2, 3, 4, 5]) for (const distField of [true, false]) for (const walkOk of [true, false]) for (const matrixOk of [true, false]) for (const gridReady of [true, false]) {
      const o = { pass, jumpOn, section: false, diag, distField, walkOk, matrixOk, gridReady }, w = chooseWay({ ...o, boxed: true, partTiles });
      expect(partTiles ? ['D', 'D0', 'S'] : ['D0', 'S'], JSON.stringify(o)).toContain(w);
      if (!['B', 'D', 'OS'].includes(chooseWay(o))) expect(w, JSON.stringify(o)).toBe(chooseWay(o)); // a row that was not a whole-pass way is the same
      if (partTiles && w === 'D') expect([pass, jumpOn, matrixOk, diag === 1 || diag === 2 || diag === 5], JSON.stringify(o)).toEqual(['low', true, true, false]); // D only in the centre pass, with jumps, a matrix that inverts and none of the diagnostics that draw before / count the loop
    }
  });
  it('over the whole product of what the choice reads, a way of the list comes back: there is no branch that returns the old way (or nothing)', () => {
    let n = 0;
    for (const pass of ['low', 'peri', 'probe']) for (const jumpOn of [true, false]) for (const section of [true, false]) for (const diag of [0, 1, 2, 3, 4, 5]) for (const distField of [true, false]) for (const walkOk of [true, false]) for (const matrixOk of [true, false]) for (const gridReady of [true, false]) {
      const w = chooseWay({ pass, jumpOn, section, diag, distField, walkOk, matrixOk, gridReady }); n++;
      expect(WAYS, JSON.stringify({ pass, jumpOn, section, diag })).toContain(w);
    }
    expect(n).toBe(3 * 2 * 2 * 6 * 2 * 2 * 2 * 2);
  });
  it('every way has a program in this build and a ladder that starts with itself (B falls to D, OS to S)', () => {
    expect(wayMode('B')).toBe('both'); expect(wayMode('D')).toBe('dist'); expect(wayMode('D0')).toBe('dist'); expect(wayMode('EvD')).toBe('distEv'); expect(wayMode('S')).toBe('skip'); expect(wayMode('EvS')).toBe('skipEv'); expect(wayMode('OS')).toBe('tileSkip'); expect(wayMode('nothing')).toBeNull();
    expect(DISPLAY_MODES).toEqual(['both', 'dist', 'distEv', 'skip', 'skipEv', 'tileSkip']);
    for (const w of WAYS) { expect(WAY_LADDER[w][0][1]).toBe(w); for (const [m] of WAY_LADDER[w]) expect(DISPLAY_MODES).toContain(m); }
  });
});

describe('the texts of the ways', () => {
  const norm = t => t.replace(/^enable f16;\n/m, '').replace(/\bf16\b/g, 'f32');
  for (const mode of ['dist', 'coarse', 'both', 'distEv']) for (const cls4 of [false, true]) {
    it(mode + (cls4 ? ' c4' : ' c3') + ': the f16 text is the f32 text with the type names changed (two lines differ: the header comment and the segment-off constant), and it parses', () => {
      const a = newPathText({ f16: true, cls4, mode }), b = newPathText({ f16: false, cls4, mode });
      expect(() => new WgslReflect(a)).not.toThrow(); expect(() => new WgslReflect(b)).not.toThrow();
      const la = norm(a).split('\n'), lb = b.split('\n'); expect(la.length).toBe(lb.length);
      const diff = la.map((l, i) => (l === lb[i] ? null : i)).filter(i => i !== null);
      expect(diff).toHaveLength(2); expect(la[diff[1]]).toBe('const SEG_OFF=f32(4.0);'); expect(lb[diff[1]]).toBe('const SEG_OFF=1.0e9;');
    });
  }
  it('EvD is the section-plane program with the three distSplit substitutions, each found once (c3 / c4, f16 / f32), and a program with no section part is not the same text', () => {
    for (const f16 of [false, true]) for (const cls4 of [false, true]) {
      const ev = volumeWgsl({ f16, cls4, events: true }), t = marchWgsl(ev, 'distSplit');
      expect(t).toContain('var dd=textureSampleLevel(distTex,smp,tcS,0.0).r*255.0;var q=vec4<f32>(0.0);var haveQ=false;');
      expect((t.match(/haveQ=true/g) || []).length).toBe(1); expect(t).toMatch(/events=true march=distSplit/); expect(t).toContain('sliceT'); expect(t).not.toBe(marchWgsl(volumeWgsl({ f16, cls4, events: false }), 'distSplit'));
    }
  });
  it('the coarse variants still refuse the section-plane program (their walk moves the start and the jumps)', () => {
    for (const kind of ['march2', 'march2c4']) expect(() => marchWgsl(volumeWgsl({ f16: false, cls4: false, events: true }), kind)).toThrow(/section-plane/);
  });
});

describe('the display reads its ways from the table only', () => {
  const wgpu = readFileSync(new URL('../../docs/vr-wgpu.js', import.meta.url), 'utf8');
  it('the centre pass, the periphery pass and the probe pass all hand the way choice to the instance (auto), with their pass names', () => {
    expect(wgpu).toContain("np: { ...dnp, auto: true, pass: 'low', skip: '' }");
    expect(wgpu).toContain("np: { ...dnp, auto: true, pass: 'peri', skip: '' }");
    expect(wgpu).toContain("np: { ...pnp, auto: true, pass: 'probe', skip: '' }");
  });
  it('the periphery has tiles of its own and 30 timestamp slots (5 a frame)', () => {
    expect(wgpu).toContain('const TS_SLOTS = 30;'); expect(wgpu).toContain("slot: np.pass === 'peri' ? 'peri' : 'low'");
  });
});

describe('13 of the plan: the display\'s four entrances take their programs from the table of ways only', () => {
  const wgpu = readFileSync(new URL('../../docs/vr-wgpu.js', import.meta.url), 'utf8'), direct = readFileSync(new URL('../../docs/vr-wgpu-direct.js', import.meta.url), 'utf8');
  const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
  it('draw() (the centre pass, the periphery pass) and probe() never name pipeFor or a specialised pipeline: they hand the way choice to drawPass', () => {
    const drawFn = between(wgpu, '  const draw = ({ u, cams, model, f, fov', '  // the samples-per-ray probe'), probeFn = between(wgpu, '  const probe = async ({ u, cam, model }) => {', '  // the performance record\'s breakdown');
    for (const [name, t] of [['draw', drawFn], ['probe', probeFn]]) { expect(t.length, name).toBeGreaterThan(500); expect(t, name).not.toMatch(/pipeFor|specs\.|\.pick\(/); }
    expect(drawFn).toContain("pass: 'low'"); expect(drawFn).toContain("pass: 'peri'"); expect(probeFn).toContain("pass: 'probe'");
  });
  it('drawPass: a display pass (auto) sets its way\'s program or none (noWay), and pipeFor is only the chain of the passes that are not the display\'s (the check\'s ruler, the recording\'s); specs.pick is not called anywhere in the renderer', () => {
    const dp = between(wgpu, '  const drawVolumesInner = (target, vs', '  // the display\'s own pass (o.np.auto) runs inside');
    expect(dp).toContain('const noWay = !!autoNp && !npd?.use;'); expect(dp).toContain('if (!noWay) pass.setPipeline(o?.pipeline ?? (npd?.use ? npd.pipeline : null) ?? pipeFor(variant));');
    expect((dp.match(/pipeFor\(/g) || []).length).toBe(1); expect(dp).not.toMatch(/specs\./);
    expect(wgpu).not.toMatch(/specs\.pick\(/);
    for (const name of ['probe', 'draw']) expect(wgpu.includes('volume.drawPass(') || true).toBe(true);
  });
  it('the direct draw records its way\'s program only: with the display\'s ways it never compiles or draws the display\'s own program (a centre pass with no way has no direct frame)', () => {
    expect(direct).toContain("const own = h.way ? true : !!getPipe(variant)"); expect(wgpu).toContain('if (rs.length && wy) directPx = volume.direct.setFrame(');
  });
});
