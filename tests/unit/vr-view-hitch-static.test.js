import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// vr-view.js is a WebXR file (not run in node), so its frame-loop wiring is checked on its source
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const loopStart = src.indexOf('renderer.setAnimationLoop(xrTs=>{'), loopEnd = src.indexOf(' const cleanup=()=>{');
const loop = src.slice(loopStart, loopEnd);
const secondTick = loop.slice(loop.indexOf('if(now-fpsAt>=1000){'));

describe('vr-view.js: the closed menu costs nothing once a second (V1)', () => {
  it('the frame loop is where expected', () => { expect(loopStart).toBeGreaterThan(0); expect(loopEnd).toBeGreaterThan(loopStart); expect(secondTick.length).toBeGreaterThan(100); });
  it('the 詳細 probe (a synchronous readRenderTargetPixels) and the menu refresh run only while the menu is open', () => {
    expect(secondTick).toContain('if(ui.open&&ui.tab===4)try{measureSamples()}');
    expect(secondTick).toContain('if(ui.open&&(ui.tab===4||ui.flash))menu.refresh();');
    expect(secondTick).toContain('if(ui.open&&ui.tab===3)menu.refresh()');
    // nothing else in the once-a-second block measures or redraws the menu unconditionally
    expect(secondTick.match(/measureSamples\(\)/g)).toHaveLength(1);
    expect(secondTick).not.toMatch(/[;{]\s*if\(ui\.tab===4\)/);
  });
  it('the menu canvas is redrawn / uploaded only while it is shown; opening it refreshes it', () => {
    expect(loop).toContain('if(ui.open)menu.flush();');
    expect(loop.match(/menu\.flush\(\)/g)).toHaveLength(1);
    expect(src).toContain('const setMenuOpen=open=>{if(open)emit(\'menu-open\');else emit(\'menu-close\');ui.open=open;menu.mesh.visible=open;if(open){placeMenuNow();ui.probeOnOpen=true}menu.refresh()};');
  });
  it('opening the menu on 詳細 measures once on the next frame (numbers not up to 1 s stale), only if it is still open there', () => {
    expect(loop).toContain('if(ui.probeOnOpen){ui.probeOnOpen=false;if(ui.open&&ui.tab===4&&!selfCheck.measuring){try{measureSamples()}catch(e){console.warn(e)}menu.refresh()}}');
    expect(loop.match(/ui\.probeOnOpen/g)).toHaveLength(2); // read and cleared in the loop; set only by setMenuOpen
  });
  it('a flash still expires while the menu is closed (no stale message on reopening)', () => {
    expect(secondTick).toContain("if(ui.flash&&now>ui.flashUntil)ui.flash='';");
  });
  it('the self-check probe (自己診断, env.probe) is unchanged: served by probeReq on the next frame whatever the menu state', () => {
    expect(loop).toContain('if(probeReq&&!selfCheck.measuring){const q=probeReq;if(q.stage===0){q.stage=1;try{measureSamples();');
  });
});

describe('vr-view.js: the no-jump interim of a rebuild does not lock the auto-quality ladder low', () => {
  it('samples taken while a shown segment waits for its texture (useDist off) are dropped', () => {
    expect(loop).toContain('const comboInterim=!!comboT?.rb?.busy&&!!uA&&!uA.useDist.value;');
    expect(loop).toContain('if(!comboInterim){const r=aq.update({volMs,mainMs,interval,budget,ctx:ctxKey,cover:rs.cover});');
    expect(loop.match(/aq\.update\(/g)).toHaveLength(1);
  });
  it('distInCls is part of the context key, so the return of the jumps clears a lock taken meanwhile', () => {
    expect(loop).toContain('settings.data|0,uA.distInCls.value].join(\'|\')');
  });
});

describe('vr-view.js: segment visibility changes rebuild the combined texture off the frame (V2)', () => {
  const rc = src.slice(src.indexOf('  const comboBox=new THREE.Box3()'), src.indexOf('  // processed segments: built once when VR starts'));
  it('refreshCombo hands a changed mask to the rebuild instead of combining and re-sending all of it', () => {
    expect(rc).toContain('t.rb.request(mask)');
    expect(rc).toContain('createComboRebuild(');
    expect(rc).not.toContain('needsUpdate=true'); // a full re-upload of the 64 MB texture
    expect(rc.match(/combineClassificationDistance\(/g)).toHaveLength(1); // only the first build of a grid (no texture yet)
    expect(rc).toContain('if(!t.combo){');
  });
  it('the slices go up through three.js (texSubImage3D from a texture the renderer never saw)', () => {
    expect(rc).toContain('renderer.copyTextureToTexture(t.comboSrc,t.combo,comboBox,comboAt)');
  });
  // the interim without jumps (variant 'full', about 20x a frame, its offscreen program compiled on
  // its first frame) is gone: the jumps stay on and the shader's shown set is held within the texture's safe mask until the upload is complete
  it('the jumps stay on through a rebuild: no switch to the general loop (distInCls / useDist never cleared for it)', () => {
    expect(rc).toContain('const applyCombo=t=>{useCombo(t);material.uniforms.useDist.value=1};');
    expect(rc).not.toContain('distInCls.value=0;material.uniforms.useDist.value=0');
    expect(rc).toContain('comboShaderMask=()=>{const t=comboT;return t?(t.rb?t.rb.safeMask:t.comboMask):15};');
  });
  it('the shader sees the shown segments within that mask, set after the rebuild step of the frame (a segment just shown appears once uploaded)', () => {
    const at = loop.indexOf('comboTick();refreshCombo();'), seg = loop.indexOf('u.segA.value[i].set(seg?.min||0,seg?.max||0,1,(held>>i&1)||(vis>>i&1)&&segAvail(seg)&&segMode[key]!==2?1:0);');
    expect(at).toBeGreaterThan(0); expect(seg).toBeGreaterThan(at);
    expect(loop).toContain('const slotKeys=gpuSegmentOrder(),vis=comboShaderMask(),sh=shownMask(),held=sh&&!(sh&vis)?vis:0;'); // a swap keeps the old set (never a blank volume)
    expect(loop.indexOf('refreshContentBox();', seg)).toBeGreaterThan(seg); // the content box reads segA after it is set
    expect(loop.match(/comboTick\(\)/g)).toHaveLength(1);
  });
  it('the prepared combined texture is built for the modes the session starts with (event mode: initialVrModes before shownMask)', () => {
    const prep = src.slice(src.indexOf('export async function prepareVrGpu('), src.indexOf('export async function prepareVrGpu(') + 4000);
    const a = prep.indexOf('initialVrModes();'), b = prep.indexOf('const mask=shownMask();');
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
  });
  it('the offscreen ray variants are compiled before the session with a render target bound (its colour space is in the program key)', () => {
    expect(src).toContain('renderer.setRenderTarget(rt);try{await renderer.compileAsync(sr,cam)}finally{renderer.setRenderTarget(prevT);rt.dispose()}');
    expect(src).toContain('for(const m of mats.slice(keys.length,2*keys.length))');
  });
  it('the rebuild advances once per frame, before the render; the session end stops it; the benchmark waits for it', () => {
    expect(loop).toContain('comboTick();refreshCombo();');
    expect(src).toContain('comboTs.forEach(t=>{t.rb.dispose();t.rb=null});');
    expect(src).toContain('if(now-bench.at>=800&&!comboT?.rb?.busy){bench.measureAt=now;');
  });
});
