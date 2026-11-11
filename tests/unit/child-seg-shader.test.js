import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeShader, volumePickShader, volumeShaderChild, volumePickShaderChild, childLutWords, childFlagsWord } from '../../docs/medical-volume.js';

// Child segments in the WebGPU volume: the child shader variants are exact-text patches of the shaders as they always were; the shaders for data without a child are untouched.
describe('child segment shaders (docs/medical-volume.js)', () => {
  it('the shaders for data without a child carry no child code', () => {
    for (const s of [volumeShader(), volumePickShader()]) expect(s).not.toMatch(/child|chRow|CH_MAT/i);
  });
  it('the child variants build (every patch anchor is found exactly once) and parse', () => {
    const v = volumeShaderChild(), p = volumePickShaderChild();
    expect(() => new WgslReflect(v)).not.toThrow();
    expect(() => new WgslReflect(p)).not.toThrow();
    expect(v).toContain('childTex'); expect(v).toContain('childLut'); expect(p).toContain('childTex');
    expect(v).toMatch(/@group\(0\) @binding\(13\) var childTex/); expect(v).toMatch(/@group\(0\) @binding\(14\) var childLut/);
    expect(p).toMatch(/@group\(0\) @binding\(6\) var childTex/); expect(p).toMatch(/@group\(0\) @binding\(7\) var childLut/);
  });
  it('the region path of the volume shader is unchanged in the variant (still the same analysisOverlay functions and results colour)', () => {
    const base = volumeShader(), v = volumeShaderChild();
    for (const frag of ['fn analysisOverlayAt(', 'fn regionOverlayNear(', 'fn analysisOverlayRow(', 'fn regionIndexAt(', 'let ov=analysisOverlayAt(ctc);', 'overlay=analysisOverlayAt(tcv);']) { expect(base).toContain(frag); expect(v).toContain(frag); }
  });
  it('a child look-up entry: colour + parent slot in row 0, shading range / opacity + 2 x material / hidden in row 1', () => {
    const f = new Float32Array(1), u = new Uint32Array(f.buffer), bits = x => { f[0] = x; return u[0]; };
    expect(childLutWords({ color: '#102030', opacity: 0.5, material: 'plastic', shade: { lower: 100, upper: 700 }, visible: true, parentSlot: 2 })).toEqual([0x10, 0x20, 0x30, 2, bits(100), bits(700), bits(0.5 + 2 * 3), 0]);
    expect(childLutWords({ color: 0xff0000, visible: false, parentSlot: 0 }, { lower: 1, upper: 9 })).toEqual([255, 0, 0, 0, bits(1), bits(9), bits(1), 1]); // default opacity 1 / material standard; the app range when the child has none
    for (const k of ['skin', 'muscle', 'fat']) expect(childLutWords({ color: 0, opacity: 0.25, material: k, parentSlot: 0 })[6]).toBe(bits(0.25)); // a saved build-709 preset packs as standard (index 0)
    expect(childLutWords({ color: 0, shade: { lower: 5, upper: 5 } }).slice(4, 6)).toEqual([0, 0]); // no usable range: upper <= lower = the parent slot's range
  });
  it('the child flags: bit s = slot s has a child, bit 4 = one is hidden', () => {
    expect(childFlagsWord([{ parentSlot: 0 }, { parentSlot: 2 }])).toBe(5);
    expect(childFlagsWord([{ parentSlot: 1, visible: false }])).toBe(2 | 16);
  });
  it('a child whose parent has no GPU slot (parentSlot -1): slot 255 in row 0 (never equal to a slot), no flag bit', () => {
    expect(childLutWords({ color: 0, parentSlot: -1 })[3]).toBe(255); expect(childLutWords({ color: 0, parentSlot: 4 })[3]).toBe(255); expect(childLutWords({ color: 0, parentSlot: 3 })[3]).toBe(3);
    expect(childFlagsWord([{ parentSlot: -1, visible: false }])).toBe(0); expect(childFlagsWord([{ parentSlot: -1 }, { parentSlot: 1 }])).toBe(2);
  });
  it('a hidden child hides only inside its own parent slot: childHiddenAt(s, tc) compares the table\'s slot, and no module-level array is indexed by a variable', () => {
    const v = volumeShaderChild(), p = volumePickShaderChild();
    for (const t of [v, p]) { expect(t).toContain('fn childHiddenAt(s:u32,tc:vec3<f32>)->bool{'); expect(t).toContain('chRow0(i).w==s&&chRow1(i).w!=0u'); expect(t.match(/childHiddenAt\((?!s:u32)(?!s,)(?!u32\()/g)).toBeNull(); }
    expect(v).not.toContain('CH_MAT'); expect(v).toContain('fn chMatOf(k:u32)->vec3<f32>{\n var t=array');
  });
});
