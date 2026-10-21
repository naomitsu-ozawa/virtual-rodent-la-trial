import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSkipState, skipGrid, buildSkipOccupancy } from '../../docs/vr-skip-occupancy.js';

// vr-view.js wires the creep skip in two places: the shader (checked pixel by pixel by tools/vr-render-golden.mjs) and skipTick, the per-frame function that
// sets useSkip / skipTex. skipTick is a closure inside the VR session, so this test runs its REAL source (cut out of vr-view.js) against mocks of what it reads.
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const start = src.indexOf('  skipTick=()=>{'), end = src.indexOf('\n  };\n', start) + 5;
const fnSrc = src.slice(start, end).replace('skipTick=', '').trim().replace(/;$/, '');

const dims = [12, 12, 12], n = 12 ** 3;
const makeCombo = (alpha, inside = []) => { const data = new Uint8Array(n * 4); for (let i = 0; i < n; i++) data[i * 4 + 3] = alpha; for (const i of inside) data[i * 4] = 200; return data; };
const rig = (over = {}) => {
 const t = { combo: { image: { data: makeCombo(1) } }, dims, cls4: null, rb: null, comboMask: 0b0111 };
 const made = [], u = { clsTex: { value: t.combo }, segA: { value: [0, 1, 2, 3].map(i => ({ w: i < 3 ? 1 : 0 })) }, useSkip: { value: 7 }, skipTex: { value: null } };
 const dummy = { dummy: true }, settings = { skipDiag: 1 };
 const env = { material: { uniforms: u }, comboT: t, P: { cls: { chan: [0, 1, 2, -1] } }, four: false, settings, createSkipState, skipGrid, makeSkipTexture: (bits, g) => { const x = { bits, g }; made.push(x); return x; }, skipDummy: () => dummy, ...over };
 const names = Object.keys(env), tick = new Function(...names, 'return (' + fnSrc + ')')(...names.map(k => env[k]));
 return { t, u, made, dummy, settings, env, tick };
};

describe('vr-view.js skipTick (the real source, mocked inputs)', () => {
 it('the source was found and is the function', () => { expect(start).toBeGreaterThan(0); expect(fnSrc.startsWith('()=>{')).toBe(true); expect(fnSrc.endsWith('}')).toBe(true); });
 it('useSkip 0 and the dummy texture until the bits are built, then 1 with the bits texture', () => {
  const { t, u, made, dummy, tick } = rig();
  let first = null; for (let i = 0; i < 100; i++) { tick(); if (u.useSkip.value === 1) { first = i; break; } expect(u.useSkip.value).toBe(0); expect(u.skipTex.value).toBe(dummy); }
  expect(first).not.toBeNull(); expect(made).toHaveLength(1); expect(u.skipTex.value).toBe(made[0]); expect(made[0].g).toEqual(skipGrid(dims));
  expect(Array.from(made[0].bits)).toEqual(Array.from(buildSkipOccupancy({ data: t.combo.image.data, dims, chan: [0, 1, 2, -1], mask: 0b0111 })));
  expect(Array.from(made[0].bits).some(v => v !== 0)).toBe(true);
 });
 it('a running rebuild (rb.busy), the 詳細 switch, a texture that is not the combined one and a segment outside the bits each give 0 at once', () => {
  const { t, u, settings, tick } = rig();
  for (let i = 0; i < 100; i++) tick();
  expect(u.useSkip.value).toBe(1);
  t.rb = { busy: true }; tick(); expect(u.useSkip.value).toBe(0);
  t.rb = { busy: false }; for (let i = 0; i < 100; i++) tick(); expect(u.useSkip.value).toBe(1);
  settings.skipDiag = 0; tick(); expect(u.useSkip.value).toBe(0);
  settings.skipDiag = 1; for (let i = 0; i < 100; i++) tick(); expect(u.useSkip.value).toBe(1);
  u.segA.value[3].w = 1; tick(); expect(u.useSkip.value).toBe(0); // a fourth segment shown: not covered by the bits of mask 0b0111
  u.segA.value[3].w = 0; tick(); expect(u.useSkip.value).toBe(1);
  const other = u.clsTex.value; u.clsTex.value = { image: {} }; tick(); expect(u.useSkip.value).toBe(0); u.clsTex.value = other; tick(); expect(u.useSkip.value).toBe(1);
 });
 it('after a rebuild that changed the bytes and the mask the bits are rebuilt from the new bytes', () => {
  const { t, u, made, tick } = rig();
  for (let i = 0; i < 100; i++) tick();
  t.rb = { busy: true }; tick(); expect(u.useSkip.value).toBe(0);
  t.combo.image.data.set(makeCombo(2, [5, 6, 7])); t.comboMask = 0b0101; u.segA.value[1].w = 0; t.rb = { busy: false };
  for (let i = 0; i < 100; i++) tick();
  expect(u.useSkip.value).toBe(1); expect(made).toHaveLength(1);
  expect(Array.from(made[0].bits)).toEqual(Array.from(buildSkipOccupancy({ data: t.combo.image.data, dims, chan: [0, 1, 2, -1], mask: 0b0101 })));
 });
 it('no combined texture (comboT null) or no material: useSkip 0, never an exception', () => {
  const a = rig({ comboT: null }); a.tick(); expect(a.u.useSkip.value).toBe(0); expect(a.u.skipTex.value).toBe(a.dummy);
  const b = rig({ material: null }); expect(() => b.tick()).not.toThrow();
 });
 it('four stored segments: the fourth channel bytes come from cls4', () => {
  const cls4 = new Uint8Array(n); cls4[100] = 255;
  const { t, u, made, tick } = rig({ four: true, P: { cls: { chan: [0, 1, 2, 3] } } });
  t.cls4 = { image: { data: cls4 } }; u.segA.value[3].w = 1; t.comboMask = 0b1111;
  for (let i = 0; i < 100; i++) tick();
  expect(u.useSkip.value).toBe(1);
  expect(Array.from(made[0].bits)).toEqual(Array.from(buildSkipOccupancy({ data: t.combo.image.data, cls4, dims, chan: [0, 1, 2, 3], mask: 0b1111 })));
 });
});
