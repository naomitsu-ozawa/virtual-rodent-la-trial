import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as L from '../../docs/lighting.js';
import { SETTINGS_DEFAULTS } from '../../docs/app-settings.js';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');

describe('質感の色味 is removed', () => {
  it('no setting, no row on the page, no wording, no VR row', () => {
    expect('tissueLook' in SETTINGS_DEFAULTS).toBe(false);
    for (const f of ['app-settings.js', 'settings-ui.js', 'ui-shell.js', 'mesh-material.js', 'vr-view.js', 'webgl-volume.js', 'medical-volume.js', 'lighting.js']) {
      const s = read(f);
      expect(s, f).not.toContain("'tissueLook'"); expect(s, f).not.toContain('set-tissue-look'); expect(s, f).not.toContain('tissueLookNow'); expect(s, f).not.toContain('materialKind');
    }
    const i18n = read('i18n.js');
    for (const k of ['setTissueLook', 'tlStandard', 'tlTrial', 'tlWeak', 'tlGloss', 'setTissueLookNote']) expect(i18n, k).not.toMatch(new RegExp('[{,\\s]' + k + ':'));
    expect(read('vr-view.js')).not.toContain('L.tlT');
    for (const k of ['TISSUE_LOOKS', 'tissueLookOf', 'tissueKindOf', 'materialVecNow', 'REAL_WEAK', 'REAL_TRIAL', 'REAL_ALL', 'REAL_KINDS', 'realTone']) expect(k in L, k).toBe(false);
  });
});

describe('the segment material is one of the four presets', () => {
  it('standard / solid / plaster / plastic only; skin / muscle / fat read as standard; the 4th number sent to a shader is 0', () => {
    expect(L.MATERIAL_KEYS).toEqual(['standard', 'solid', 'plaster', 'plastic']);
    for (const k of ['skin', 'muscle', 'fat']) { expect(L.materialKey(k)).toBe('standard'); expect(L.materialVec(k)).toEqual(L.materialVec('standard')); }
    for (const k of L.MATERIAL_KEYS) expect(L.materialVec(k)[3]).toBe(0);
  });
  it('the page has four options per segment card, no wording for the removed ones', () => {
    const shell = read('ui-shell.js'), i18n = read('i18n.js');
    const sels = [...shell.matchAll(/<select class="filter-select" data-seg-material="(\w+)">(.*?)<\/select>/g)];
    expect(sels.length).toBe(5);
    for (const m of sels) expect([...m[2].matchAll(/value="(\w+)"/g)].map(x => x[1]), m[1]).toEqual(L.MATERIAL_KEYS);
    for (const k of ['matSkin', 'matMuscle', 'matFat']) expect(i18n, k).not.toMatch(new RegExp('[{,\\s]' + k + ':'));
  });
});

describe('the surface is the plain model, the cut face always gets the cut look', () => {
  it('no surface branch to the tissue model in any of the four paths (VR, page WebGL, WebGPU, meshes)', () => {
    for (const f of ['vr-view.js', 'webgl-volume.js', 'medical-volume.js', 'lighting.js']) expect(read(f), f).not.toMatch(/vrlReal\(/);
    expect(L.patchStandardFragment('void main(){\n#include <opaque_fragment>\n}')).toContain('outgoingLight=pow(max(diffuseColor.rgb*vrlS.x+vec3(vrlS.y),0.0)');
  });
  it('every cap site calls vrlRealCut without a material test (VR x2, page WebGL through the VR text, WebGPU x1)', () => {
    const vr = read('vr-view.js'), wg = read('webgl-volume.js'), mv = read('medical-volume.js');
    expect(vr.match(/VRL_MP vec3 lit=vrlRealCut\(mix\(regionColor\(cp,segC\[ci\]\.rgb,ci\),vec3\(1\.0\),0\.22\),n,viewDir,vLightOff,vrlDepth01\(capAt,o,halfExt\)\);/g)).toHaveLength(2);
    expect(vr).not.toMatch(/segM\[ci\]\.w/);
    expect(wg).toContain("put: 'VRL_MP vec3 lit=vrlRealCut(mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22),n,viewDir,vLightOff,vrlDepth01(capAt,o,halfExt))*capHatchF(cp,capPlane)*capShadeF(cp,ci);'");
    expect(mv).not.toContain('u.segMat[u32(capIndex)].w');
    expect(mv.match(/capColor=vrlRealCut\(capColor,capN,-dir,/g)).toHaveLength(1);
  });
  it('the slice fill at 0 % keeps its own gate (not part of this change)', () => {
    expect(read('vr-view.js')).toContain('if(m.w<0.5||m.w>3.5)return col;');
  });
  it('the cut look uses the muscle values of (ambient 0.26, REAL[2]), one set, no per-kind chain', () => {
    expect(L.CUT_REAL).toEqual({ ambient: 0.26, wrap: [0.12, 0.22, 0.16], sky: [0.95, 1, 0.99], ground: [0.95, 0.5, 0.4], spec1: 0.08, sh1: 5, spec2: 0.12, sh2: 28 });
    for (const src of [L.lightingGLSL(), L.lightingWGSL()]) {
      expect(src).toContain('0.26*mix('); expect(src).toContain('(0.08*exp2(lp*5.0)+0.12*exp2(lp*28.0))*0.5'); expect(src).toContain('*1.1;');
      expect(src).not.toMatch(/if\(k</);
    }
  });
});
