import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as L from '../../docs/lighting.js';
import { SETTINGS_DEFAULTS } from '../../docs/app-settings.js';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const look = v => { globalThis.__vrlSettings = { get: k => (k === 'tissueLook' ? v : undefined) }; };
afterEach(() => { delete globalThis.__vrlSettings; });

describe('tissue look: the kind each look sends to the shaders', () => {
  it('the default is 標準 and the four looks are in the order of the menus', () => {
    expect(SETTINGS_DEFAULTS.tissueLook).toBe('standard'); expect(L.TISSUE_LOOK_DEFAULT).toBe('standard');
    expect(L.TISSUE_LOOKS).toEqual(['standard', 'trial', 'weak', 'gloss']);
    expect(L.tissueLookOf('nonsense')).toBe('standard'); expect(L.tissueLookOf(undefined)).toBe('standard');
  });
  it('kind per look: 標準 0 for every preset; 艶と断面 1..3; 弱い版 4..6; 試作 7..9; the plain presets stay 0 in every look', () => {
    for (const k of [0, 1, 2, 3]) expect(L.tissueKindOf(k, 'standard')).toBe(0);
    expect([1, 2, 3].map(k => L.tissueKindOf(k, 'gloss'))).toEqual([1, 2, 3]);
    expect([1, 2, 3].map(k => L.tissueKindOf(k, 'weak'))).toEqual([4, 5, 6]);
    expect([1, 2, 3].map(k => L.tissueKindOf(k, 'trial'))).toEqual([7, 8, 9]);
    for (const l of L.TISSUE_LOOKS) expect(L.tissueKindOf(0, l)).toBe(0);
  });
  it('materialVecNow follows the setting now (and materialVec stays the preset own numbers)', () => {
    expect(L.materialVecNow('skin')[3]).toBe(0); // no setting object at all: the default
    for (const [lk, kinds] of [['standard', [0, 0, 0]], ['gloss', [1, 2, 3]], ['weak', [4, 5, 6]], ['trial', [7, 8, 9]]]) { look(lk); expect(['skin', 'muscle', 'fat'].map(k => L.materialVecNow(k)[3])).toEqual(kinds); expect(L.materialVecNow('plastic')[3]).toBe(0); }
    expect(['skin', 'muscle', 'fat'].map(k => L.materialVec(k)[3])).toEqual([1, 2, 3]);
    look('nonsense'); expect(L.materialVecNow('muscle')[3]).toBe(0);
  });
  it('the mesh materials take the look of the setting when it changes (refreshMeshLooks), the preset is kept', async () => {
    const M = await import('../../docs/mesh-material.js'), THREEcore = await import('three');
    M.setMeshMaterialBackend('WEBGL');
    const m = M.createSurfaceMaterial({ color: '#f3f0e8' }, 'tl-seg'), a = { uniforms: {}, fragmentShader: THREEcore.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(a);
    M.setSegmentMeshMaterial('tl-seg', 'muscle'); expect(a.uniforms.vrlMeshMat.value.w).toBe(0);
    for (const [lk, w] of [['gloss', 2], ['weak', 5], ['trial', 8], ['standard', 0]]) { look(lk); M.refreshMeshLooks(); expect(a.uniforms.vrlMeshMat.value.w).toBe(w); }
    M.setMeshMaterialBackend('WEBGPU');
  });
});

describe('tissue look: the three tables in the shaders', () => {
  const keys = Object.keys(L.REAL_ALL).map(Number);
  it('REAL is 艶と断面 (kinds 1..3), REAL_WEAK is the 3e5e45fd table, REAL_TRIAL the 32bab049 table; the shaders carry the nine kinds as one chain', () => {
    expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(L.REAL_WEAK[2].spec2).toBe(0.55); expect(L.REAL_WEAK[2].wrap).toEqual([0.12, 0.22, 0.16]); expect(L.REAL_TRIAL[1].wrap).toEqual([0.7, 0.42, 0.3]); expect(L.REAL[2].spec2).toBe(0.12);
    for (const src of [L.lightingGLSL(), L.lightingWGSL()]) {
      for (const i of keys) { const P = L.REAL_ALL[i]; expect(src).toContain('P=' + (src.includes('fn ') ? 'vec4<f32>' : 'vec4') + '(' + [P.spec1, P.sh1, P.spec2, P.sh2].map(x => (Number.isInteger(x) ? x.toFixed(1) : String(x))).join(',') + ')'); }
      expect(src).toContain('if(k<1.5){'); expect(src).toContain('else if(k<8.5){'); expect(src).toMatch(/else\{W=/);
    }
  });
  it('the JS twin (realTone) takes a kind 1..9: the same kind of another set gives another colour, the set table is the one named', () => {
    const col = [0.8, 0.8, 0.8], n = [0.2, 0.4, 1].map(x => x / Math.hypot(0.2, 0.4, 1)), V = [0, 0, 1], off = [0.3, 0.5, 0];
    const at = k => L.realTone(col, n, V, off, 0, false, 0.26, k);
    expect(at(2)).not.toEqual(at(5)); expect(at(5)).not.toEqual(at(8)); expect(at(2).every(Number.isFinite) && at(5).every(Number.isFinite) && at(8).every(Number.isFinite)).toBe(true);
  });
  it('the cut face / slice look (vrlRealCut) is only for kinds 1..3: every call site tests w < 3.5', () => {
    const vr = read('vr-view.js'), wg = read('webgl-volume.js'), mv = read('medical-volume.js');
    expect(vr.match(/segM\[ci\]\.w>0\.5&&segM\[ci\]\.w<3\.5\)lit=vrlRealCut\(/g)).toHaveLength(2); expect(vr).toContain('if(m.w<0.5||m.w>3.5)return col;');
    expect(wg.match(/segM\[ci\]\.w>0\.5&&segM\[ci\]\.w<3\.5\)lit=vrlRealCut\(/g)).toHaveLength(2);
    expect(mv).toContain('u.segMat[u32(capIndex)].w>0.5&&u.segMat[u32(capIndex)].w<3.5');
  });
});

describe('tissue look: the setting, its row on the page, its row in the VR menu, the wording', () => {
  it('app-settings stores it (default 標準, an unknown stored value reads as 標準), settings-ui binds and syncs it', () => {
    const a = read('app-settings.js'), ui = read('settings-ui.js');
    expect(a).toContain("tissueLook:'standard'"); expect(a).toContain("if(!['standard','trial','weak','gloss'].includes(values.tissueLook))values.tissueLook='standard';");
    expect(ui).toContain("bind('set-tissue-look','tissueLook');"); expect(ui).toContain("put('set-tissue-look',v.tissueLook);");
  });
  it('the dialog has the select in 描画 after the hand laser row, four options in the order of the menus, all with wording in ja and en', () => {
    const shell = read('ui-shell.js'), i18n = read('i18n.js');
    const row = shell.match(/<select id="set-tissue-look">(.*?)<\/select>/)[1];
    expect([...row.matchAll(/value="(\w+)" data-i18n="(\w+)"/g)].map(m => m[1])).toEqual(L.TISSUE_LOOKS);
    expect(shell.indexOf('id="set-hand-ray"')).toBeLessThan(shell.indexOf('id="set-tissue-look"')); expect(shell.indexOf('id="set-tissue-look"')).toBeLessThan(shell.indexOf('id="set-mpr-alpha"'));
    for (const k of ['setTissueLook', 'tlStandard', 'tlTrial', 'tlWeak', 'tlGloss', 'setTissueLookNote']) expect([...i18n.matchAll(new RegExp('[{,\\s]' + k + ':', 'g'))].length, k).toBe(2);
    expect(i18n).toContain("tlStandard:'標準'"); expect(i18n).toContain("tlGloss:'艶と断面'");
  });
  it('the VR menu has the same choice in the 画質 tab, the same four values, wording in ja and en; the setting is read by materialKind every frame', () => {
    const vr = read('vr-view.js');
    expect(vr).toContain("tlT:'質感の色味',tlV:['標準','試作','弱い版','艶と断面']"); expect(vr).toContain("tlT:'Tissue look',tlV:['Standard','Trial','Soft','Gloss+cut']");
    expect(vr).toContain("choice(y0+790,L.tlT,L.tlV.map((t,i)=>({label:t,value:TISSUE_LOOKS[i]})),tissueLookNow(),v=>{try{globalThis.__vrlSettings?.set?.('tissueLook',v)}catch{}");
    expect(vr).toContain('u.segM.value[i].set(mat.ambient,mat.spec,mat.shininess,materialKind(mat))');
  });
});
