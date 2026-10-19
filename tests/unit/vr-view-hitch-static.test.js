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
    expect(src).toContain('const setMenuOpen=open=>{ui.open=open;menu.mesh.visible=open;if(open){placeMenuNow();ui.probeOnOpen=true}menu.refresh()};');
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
  it('until the rebuild is complete, the jumps are on only when rb.jumpsSafe; otherwise the general loop without jumps from the same texture', () => {
    expect(rc).toContain('if(t.rb?t.rb.jumpsSafe(shown):t.comboMask===shown){useCombo(t);material.uniforms.useDist.value=1;return}');
    expect(rc).toContain('material.uniforms.clsTex.value=t.combo;material.uniforms.clsChan.value.set(...P.cls.chan);material.uniforms.distInCls.value=0;material.uniforms.useDist.value=0;');
  });
  it('the rebuild advances once per frame, before the render; the session end stops it; the benchmark waits for it', () => {
    expect(loop).toContain('comboTick();refreshCombo();refreshContentBox();');
    expect(src).toContain('comboTs.forEach(t=>{t.rb.dispose();t.rb=null});');
    expect(src).toContain('if(now-bench.at>=800&&!comboT?.rb?.busy){bench.measureAt=now;');
  });
});
