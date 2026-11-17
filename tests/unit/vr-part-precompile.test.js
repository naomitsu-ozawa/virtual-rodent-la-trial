// n736: the VRL_PART programs are compiled before the VR / AR session (prepareVrGpu) so that the first cut-out compiles nothing, and the cut-out says so on the board in front of the head
// (loadBoard, the data switch's board) while it runs. vr-view.js is not runnable here: the wiring is checked on its source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PART_TEXT } from '../../docs/vr-part-view.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); expect(i).toBeGreaterThan(-1); expect(j).toBeGreaterThan(i); return src.slice(i, j); };

describe('the page compiles the parts\' programs before the session', () => {
  it('one maker builds the program set for the page and for the session: the same defines (same order) and shaders, so three.js finds the programs in its cache', () => {
    expect(src).toContain("const partBaseOf=(k,u)=>makeVolumeBase({...definesOfKey(k),VRL_PART:''},u);");
    expect(src).toContain('export const partMaterialsOf=(k,u)=>{const vars=materialVariants(partBaseOf(k,u));return{vars,rays:rayVariantsOf(vars)}};');
    // the session's template (partEnsure compiles res.tpl) is made by it, with the session's own set key
    expect(src).toContain('const partMaterials=own=>{const u=partUniforms(unifs,own),m=partMaterialsOf(setKey,u);return{u,vars:m.vars,rays:m.rays}};');
    // and nowhere else is a VRL_PART base made
    expect(src.match(/VRL_PART:''/g).length).toBe(1);
  });
  it('prepareVrGpu compiles every variant partEnsure can ask for (direct + ray copies), kept alive for the session, only for a set with results / child segments', () => {
    const pre = slice('  assets.part=null;', 'times.compile=performance.now()-t1;');
    expect(pre).toContain("settings?.precompileSets!==false&&setKeyOf(P)!=='-'");
    expect(pre).toContain('partPreKeys(four)');
    expect(pre).toContain('partMaterialsOf(own,u)');
    expect(pre).toContain('compileVariantPrograms(renderer,pk.map(k=>pv.vars[k]),pk.map(k=>pv.rays[k]))');
    expect(pre).toContain('assets.warmMore.push(');
    // not behind shouldPrecompileSets: a device with a parallel compile (the Quest) needs it too
    expect(pre).not.toContain('shouldPrecompileSets');
    // the keys: full / combined / noEvents, and the four-segment forms when the data has four segments
    expect(src).toContain('const partPreKeys=four=>four?[...VARIANT_KEYS,...VARIANT_KEYS4]:VARIANT_KEYS;');
  });
  it('the keys cover what partEnsure asks for (partVariantKey, partFull, variantKey)', () => {
    const ens = slice('const wanted=[partVariantKey(unifs),partFull(),variantKey()]', 'await compileVariantPrograms(');
    expect(ens).toContain('partVariantKey(unifs)');
    // partVariantKey: full / noEvents (+4); partFull: full (+4); variantKey: full / noEvents / combined (+4)
    for (const k of ["'full'", "'noEvents'", "'combined'"]) expect(src).toContain(k);
    expect(src).toContain("const variantKey=()=>{const u=material.uniforms,k=!(u.distInCls.value>0&&u.useCls.value>0)||(settings.diag|0)?'full':u.planeCount.value===0?'noEvents':'combined';return cls4On?k+'4':k};");
  });
  it('the session keeps the page\'s materials alive (gpuWarm includes warmMore), so the programs stay in the cache', () => {
    expect(src).toContain('gpuWarm=gpu?[...gpu.warm,...(gpu.warmMore||[])]:[]');
  });
});

describe('the cut-out board', () => {
  const det = slice('   const partDetach=async tg=>{', '   // a part\'s pose');
  it('the texts: the title, the three stages and the seconds, in both languages', () => {
    expect(PART_TEXT.ja.cutTitle).toBe('切り出し中');
    expect([PART_TEXT.ja.cutPrep, PART_TEXT.ja.cutCalc, PART_TEXT.ja.cutFinish]).toEqual(['準備中', '計算中', '仕上げ中']);
    expect(PART_TEXT.ja.cutSecs).toContain('{s}');
    expect(PART_TEXT.en.cutSecs).toContain('{s}');
  });
  it('it is the data switch\'s board: set when the cut starts (placed in front of the head), the stages follow the cut, ended in the finally', () => {
    expect(det).toContain("const cutInfo={cut:true,name:cutNameOf(tg),stage:'prep'");
    expect(det).toContain('loadInfo=cutInfo;loadBoard.refresh();placeLoadNow();');
    expect(det).toContain("cutStage('calc')");
    expect(det).toContain("()=>cutStage('finish')");
    expect(det).toMatch(/finally\{partBusy=false;partCutEnd\(cutInfo\);/);
    // the board starts after the refusals (busy / same target / pair) and not for the bake, which runs later from the frame
    expect(det.indexOf('loadInfo=cutInfo')).toBeGreaterThan(det.indexOf('if(partBusy){flashMsg(PT.busy,2500);return false}'));
    expect(src.slice(src.indexOf('const bakeStart='), src.indexOf('const partApply='))).not.toContain('loadInfo');
  });
  it('it goes in every case: shown part, failure (finally), undone / replaced (finally), data switch and session end (partDispose), page hidden, and by the frame once the cut is over', () => {
    expect(src).toContain("partDispose=()=>{\n    partCutEnd();");
    expect(src).toContain('const partCutEnd=info=>{if(loadInfo&&loadInfo.cut&&(!info||loadInfo===info)){loadInfo=null;loadBoard.mesh.visible=false}};');
    expect(src).toContain("if(loadInfo?.cut&&!partCutLive())partCutEnd(loadInfo);");
    expect(src).toContain('partCutLive=()=>partBusy&&!!running;');
    expect(src).toContain("document.addEventListener('visibilitychange',partCutVis);session.addEventListener('visibilitychange',partCutVis);");
    expect(src).toContain("document.removeEventListener('visibilitychange',partCutVis)");
    expect(src).toContain("if(document.visibilityState==='hidden'||session?.visibilityState==='hidden')partCutEnd()");
    // cleanup (session end) calls partDispose
    expect(src).toMatch(/const cleanup=\(\)=>\{[^\n]*\n\s*partDispose\(\);/);
  });
  it('a board of the data switch or the pair is never taken down by a cut, and a pair does not start under a cut', () => {
    expect(src).toContain('loadInfo&&loadInfo.cut&&');
    expect(src).toContain('if(ui.swapBusy||pairLoading||loadInfo?.cut||!pairRowOn())return;');
    expect(src).toContain('if(pair?.on||pairLoading){flashMsg(PT.pairBusy,3000);return false}');
  });
  it('the board draws the cut\'s own words and no blocking work is added: it is redrawn by the same twice-a-second frame hook', () => {
    const draw = slice(' loadBoard.onDraw(()=>{', ' const placeLoadNow=');
    expect(draw).toContain('cut?PTc.cutTitle:');
    expect(draw).toContain('cut?PTc.cutSecs.replace(');
    expect(draw).toContain('PART_CUT_STAGES');
    expect(src).toContain("const PART_CUT_STAGES=['prep','calc','finish'];");
  });
});
