import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NEAR_KINDS, pickNearGrab, boxDist, centeredBoxDist, squareOutlineDist } from '../../docs/vr-hand.js';

// hand tracking. vr-view.js / vr-hand-view.js are WebXR files (not run in node): the guards are checked on the source, and the
// disconnect release is run from its own source text against stand-ins for the closure variables.
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const hv = readFileSync(new URL('../../docs/vr-hand-view.js', import.meta.url), 'utf8');
const lineOf = (s, w) => { const a = s.indexOf(w); expect(a, w).toBeGreaterThanOrEqual(0); return s.slice(s.lastIndexOf('\n', a) + 1, s.indexOf('\n', a)); };
// the body of the arrow / function that starts at the first '{' after `from`
const bodyAfter = (s, from) => {
  const a = s.indexOf(from); expect(a, from).toBeGreaterThanOrEqual(0);
  const o = s.indexOf('{', a + from.length - 1); let d = 0;
  for (let i = o; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return s.slice(o + 1, i); }
  throw new Error('unbalanced ' + from);
};

describe('vr-view.js: hand tracking is optional and every hand branch is guarded (controllers unchanged)', () => {
  it("'hand-tracking' is an optional feature only", () => {
    expect(src).toContain("{optionalFeatures:['local-floor','hand-tracking']}");
    expect(src).not.toMatch(/requiredFeatures[^\n]*hand-tracking/);
  });
  it('pulse(): a hand gets the visual swell before (instead of) the gamepad haptics; the controller call is the same', () => {
    const l = lineOf(src, 'const pulse=(c,');
    expect(l).toContain('if(isHand(c?.userData?.source)){handIn.flash(c,v,ms);return}');
    expect(l.indexOf('isHand(')).toBeLessThan(l.indexOf('hapticActuators'));
    expect(l).toContain('try{c.userData.source?.gamepad?.hapticActuators?.[0]?.pulse?.(v,ms)}catch{}');
  });
  it('connected: a hand returns before the badge; the controller path still adds the X badge on the left', () => {
    const l = lineOf(src, "c.addEventListener('connected'");
    expect(l).toMatch(/if\(isHand\(e\.data\)\)\{handIn\.connect\(c,controllers\.indexOf\(c\)\);[^}]*return\}/);
    expect(l.indexOf('return}')).toBeLessThan(l.indexOf("handedness==='left')c.add(badge)"));
  });
  it('squeezestart / squeezeend: a hand returns first (its fist is the grip, via handIn); a controller runs gripStart / gripEnd', () => {
    const st = bodyAfter(src, "c.addEventListener('squeezestart',()=>{"), en = bodyAfter(src, "c.addEventListener('squeezeend',()=>{");
    expect(st.trimStart().startsWith('if(isHand(c.userData.source))return;')).toBe(true); expect(st).toContain('gripStart(c);');
    expect(en.trimStart().startsWith('if(isHand(c.userData.source))return;')).toBe(true); expect(en).toContain('gripEnd(c);');
    expect(st).not.toContain('grabbing.add'); expect(en).not.toContain('grabbing.delete'); // the bodies live in gripStart / gripEnd
  });
  it('gripStart / gripEnd keep the controller bodies (menu, help, histogram, HU panel, then the volume); they attach to holdOf(c)', () => {
    const gs = bodyAfter(src, 'const gripStart=c=>{'), ge = bodyAfter(src, 'const gripEnd=c=>{');
    const order = ['ui.open&&!menuHeld&&boardHits(c).menu', '!helpHeld&&c.userData.helpHit', '!histHeld&&c.userData.histHit', '!huHeld&&boardHits(c).hu', 'grabbing.add(c);regrab();'].map(w => gs.indexOf(w));
    expect(order.every(i => i >= 0)).toBe(true); expect([...order].sort((x, y) => x - y)).toEqual(order);
    for (const w of ['holdOf(c).attach(menu.mesh)', 'holdOf(c).attach(help.mesh)', 'holdOf(c).attach(hist.group)', 'holdOf(c).attach(huLine.panel)']) expect(gs).toContain(w);
    expect(gs).not.toMatch(/[^f(]c\.attach\(/); // never c.attach directly (a hand's boards go to its palm anchor)
    for (const w of ['menuHeld===c', 'helpHeld===c', 'histHeld===c', 'huHeld===c', 'if(grabbing.delete(c))regrab();']) expect(ge).toContain(w);
    expect(ge).toContain('scene.attach(menu.mesh)'); expect(ge).toContain('menu.mesh.lookAt(head)');
    expect(src).toContain('const holdOf=c=>handIn.holder(c);');
    // the single-hand grab and the two-hand distance (scale) use the same holder; two fists = two grips = pinchScale as for two controllers
    expect(lineOf(src, 'else if(grabbing.size===1)')).toContain('holdOf([...grabbing][0]).attach(holder)');
    expect(lineOf(src, 'const handDist=')).toContain('holdOf(controllers[0]).getWorldPosition(tmpA);holdOf(controllers[1]).getWorldPosition(tmpB)');
    expect(src).toContain('if(twoHand)holder.scale.setScalar(pinchScale(twoHand.s0,twoHand.d0,handDist(),realLongMm()));');
    for (const w of ['help.mesh.parent===holdOf(c)', 'p.parent===holdOf(c)', 'hist.group.parent===holdOf(c)']) expect(src).toContain(w);
  });
  it('a controller: holder(c) is c itself; a hand: its palm anchor, only once the anchor was placed', () => {
    const b = bodyAfter(hv, 'holder(c){');
    expect(b).toContain('isHand(c.userData.source)&&hs?.anchorOk?hs.anchor:c');
    const f = new Function('isHand', 'c', 'const hs=c.userData.hs;' + b.replace('const hs=c.userData.hs;', ''));
    const isHand = s => !!(s && s.hand), ctrl = { userData: { source: { gamepad: {} } } }, anchor = {};
    expect(f(isHand, ctrl)).toBe(ctrl);
    const h = { userData: { source: { hand: {} }, hs: { anchor, anchorOk: false } } }; expect(f(isHand, h)).toBe(h);
    h.userData.hs.anchorOk = true; expect(f(isHand, h)).toBe(anchor);
  });
  it("the hand's fist: never on a controller (frame skips non-hands), refused on the wrist menu, dropped press, busy = drags", () => {
    const g = bodyAfter(hv, 'const grabStep=(c,hs,now)=>{');
    expect(g).toContain('hs.grab.update(fistScore(hs),now,!!busy(c))');
    expect(g).toContain("if(c.userData.press)release(c);");
    expect(g).toContain('if(grab(c,hs.near)===false)hs.grab.release();');
    expect(g).toContain("else if(ev==='end')ungrab(c);");
    expect(bodyAfter(hv, 'frame(now){')).toContain('if(tick(c,hs,now)&&(c.visible||hs.grab.active||hs.pinch.pressed)){grabStep(c,hs,now);carryStep(c,hs,now);pinchStep(c,hs,now)}'); // after the isHand(s) continue
    expect(bodyAfter(hv, 'frame(now){').indexOf('grabStep(')).toBeGreaterThan(bodyAfter(hv, 'frame(now){').indexOf('if(!isHand(s)){ctrl=true;continue}'));
    expect(src).toContain('grab:(c,t)=>{if(t){gripStartNear(c,t);return true}if(c.userData.wristOn)return false;gripStart(c);return true}'); // no target near: the laser path, unchanged
    expect(src).toContain('ungrab:c=>{if(c.userData.drag?.fist){endDrag(c);return}gripEnd(c)}');
    expect(src).toContain('busy:c=>!!(c.userData.drag||c.userData.lblDrag||histAxis===c||dragging?.c===c||huLine.isDragging())');
    expect(src).toContain('c.userData.wristOn=!!bd.wrist;');
    // tracking loss: release() lets go of what the fist held and latches the detector; a lost hand does not grab
    expect(bodyAfter(hv, 'const tick=(c,hs,now)=>{')).toContain("if(st==='cancel'){release(c);hs.rebased=null;hs.grab.release();dropPinch(hs)}");
    expect(bodyAfter(hv, 'const tick=(c,hs,now)=>{')).toContain('return false}');
    // a grabbing hand is no trigger and does not show the wrist menu
    expect(bodyAfter(hv, 'frame(now){')).toContain('left.userData.drag||hs.grab.active');
  });
  it('selectstart ignores a pinch the system sees inside a fist (first thing); selectend stops the wrist 断面 +/-', () => {
    const b = bodyAfter(src, "c.addEventListener('selectstart',e=>{");
    expect(b.trimStart().startsWith('if(isHand(c.userData.source)&&(!e.handPinch||handIn.grabbing(c)||handIn.fistLike(c)))return;')).toBe(true);
    expect(src).toContain("c.addEventListener('selectend',e=>{if(isHand(c.userData.source)&&!e.handPinch)return;c.userData.wristScroll=null});");
    expect(bodyAfter(hv, 'grabbing(c){')).toContain('isHand(c.userData.source)');
  });
  it('wrist 断面 -/+: only from a hand, only with a selected section, added to the stick scroll (the same SCROLL_SPEED / clamp path)', () => {
    const l = lineOf(src, "case'secDown':case'secUp':");
    expect(l).toContain('if(section.on&&section.selected)c.userData.wristScroll={id,sign:wristScrollSign(id),t0:performance.now()}');
    const sc = lineOf(src, 'const ws=c.userData.wristScroll');
    expect(sc).toContain('!isHand(c.userData.source)||!handIn.wristShown||!section.on||!section.selected||!wristScrollKeep(ws.id,');
    expect(sc).toContain('scroll+=ws.sign*wristScrollGain(nowF-ws.t0)');
    expect(src).toContain('const ay=c.userData.source?.gamepad?.axes?.[3]||0,am=Math.abs(ay);if(am>0.15&&!c.userData.stickLock&&wheelOwner!==c&&pw?.c!==c)scroll+=Math.sign(ay)*((am-0.15)/0.85)**2;'); // the stick line itself is unchanged
    expect(src).toContain('sp.obj.translateX(-scroll*SCROLL_SPEED*dt/ps)');
    expect(src).toContain("id==='secUp'||id==='secDown'?!!(section.on&&section.selected&&planes.includes(section.selected))");
  });
  it("the hand's select pre-hook runs before vr-view's own select handlers and only re-applies a hand's pose", () => {
    const pre = src.indexOf("for(const t of ['selectstart','selectend'])c.addEventListener(t,e=>handIn.eventPose(c,e))");
    expect(pre).toBeGreaterThan(0);
    expect(pre).toBeLessThan(src.indexOf("c.addEventListener('selectstart',e=>{"));
    expect(bodyAfter(hv, 'eventPose(c,e){')).toMatch(/^if\(!isHand\(c\.userData\.source\)\)return;/);
  });
  it('drag thresholds: a hand uses its own (handIn.dragTh) behind isHand(); a controller keeps pr.dragRec?DRAG_RECORD:undefined', () => {
    expect(lineOf(src, 'const th=')).toContain('const th=isHand(c.userData.source)?handIn.dragTh(c,pr):(pr.dragRec?DRAG_RECORD:undefined);');
    expect(lineOf(src, 'HAND_LABEL_MOVE_M:0.008')).toContain('(isHand(c.userData.source)?HAND_LABEL_MOVE_M:0.008)');
  });
  it('every other handIn / wrist use in vr-view.js is behind isHand() or comes from a hand-only call', () => {
    const own = ['import ', 'const handIn=createHandInput(', "session.addEventListener('end',()=>handIn.dispose()", "for(const t of ['selectstart','selectend'])"];
    const handOnlyApi = ['handIn.frame(', 'handIn.wristHit(', 'handIn.hover(', 'handIn.wristId(', 'handIn.anyHand()', 'handIn.drop(c)', 'handIn.connect(', 'handIn.flash(', 'handIn.dragTh(', 'handIn.holder(', 'handIn.grabbing(', 'handIn.reach(', 'handIn.wristShown'];
    for (const l of src.split('\n').filter(x => /handIn\.|bd\.wrist|o\.wrist|HAND_LABEL_MOVE_M/.test(x))) {
      if (own.some(w => l.includes(w))) continue;
      const ok = l.includes('isHand(') || l.includes('c.userData.hs') || handOnlyApi.some(w => l.includes(w)) || /bd\.wrist|o\.wrist/.test(l);
      expect(ok, l.trim().slice(0, 120)).toBe(true);
    }
    // the hand-only API checks the input source itself
    expect(bodyAfter(hv, 'connect(c,i){')).toMatch(/^if\(!isHand\(c\.userData\.source\)\)return;/);
    expect(bodyAfter(hv, 'flash(c,amp,ms){')).toContain('if(!isHand(c.userData.source)||!hs)return;');
    expect(bodyAfter(hv, 'wristHit(c,raycaster,setRay){').trimStart()).toMatch(/^if\(!isHand\(c\.userData\.source\)\|\|!wrist\.visible\|\|c===leftC\)return null;/);
    expect(bodyAfter(hv, 'frame(now){')).toContain('if(!isHand(s)){ctrl=true;continue}');
    // the wrist menu only via o.wrist (a hand's ray), and it is the only producer of bd.wrist
    expect(src).toContain('o.wrist=handIn.wristHit(c,raycaster,setRay);');
    expect(src.match(/o\.wrist=/g)).toHaveLength(2); // the assignment above and the nearest-board fix-up (o.wrist=null)
    expect(lineOf(src, 'if(bd.wrist){ray.renderOrder')).toMatch(/^\s*if\(isHand\(c\.userData\.source\)\)\{/);
  });
  it('getHand is called only in vr-hand-view.js, when a hand connects', () => {
    expect(src.includes('getHand(')).toBe(false);
    expect(hv.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').match(/getHand\(/g)).toHaveLength(1); // code, not comments
    expect(bodyAfter(hv, 'connect(c,i){')).toContain('renderer.xr.getHand(i)');
  });
  it('the pre-existing pinned lines are untouched (the controller laser / board order)', () => {
    expect(src).toContain("{const top=!!rh||res.kind==='point'||res.kind==='mlabel'||res.kind==='section'||!!bd.hu;ray.renderOrder=dot.renderOrder=bd.hu?11:top?8:0;");
    expect(src).toContain("for(const k of ['menu','help','hist','wheel','pwheel','undoBtn','hu'])");
    expect(src).toContain('c.userData.gate.update(c.userData.source?.gamepad?.axes?.[2]||0,ay,performance.now());'); // a hand has no gamepad axes: 0 -> the gate always allows recording
    expect(src).toContain('const ay=c.userData.source?.gamepad?.axes?.[3]||0');
    expect(src).toContain('const bt=c.userData.source?.gamepad,ax=bt?.axes?.[2]||0,ay=bt?.axes?.[3]||0;');
  });
});

describe('the own pinch and the carried pinch drag are hands only (controllers unchanged)', () => {
  const code = t => t.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  it("a controller's select runs exactly as before: every new first line is behind isHand(); the controller bodies follow unchanged", () => {
    const st = bodyAfter(src, "c.addEventListener('selectstart',e=>{"), en = bodyAfter(src.slice(src.indexOf("c.addEventListener('selectend',e=>{\n")), "c.addEventListener('selectend',e=>{");
    expect(st.trimStart().split('\n')[1].trim()).toBe('endDrag(c);'); // the controller body starts right after the hand line, as before
    expect(en.trimStart().startsWith('if(isHand(c.userData.source)&&!e.handPinch)return;')).toBe(true);
    expect(en.trimStart().split('\n')[1].trim().startsWith('if(histAxis===c){histAxisEnd(true);pulse(c,0.2);return}')).toBe(true);
    // the only handPinch readers in vr-view.js are those three hand guards
    expect(code(src).match(/handPinch/g)).toHaveLength(3);
    for (const l of src.split('\n').filter(x => x.includes('e.handPinch'))) expect(l).toContain('isHand(c.userData.source)&&');
  });
  it("vr-hand-view.js dispatches the hand's selectstart / selectend only from pinchEdge, reached from a hand's frame step or a hand's system select", () => {
    const h = code(hv);
    expect(h.match(/dispatchEvent\(/g)).toHaveLength(2);
    expect(h.match(/dispatchEvent\(\{type:'select(start|end)',handPinch:true/g)).toHaveLength(2);
    const pe = bodyAfter(hv, 'const pinchEdge=(c,hs,ev,now)=>{'); expect(pe).toContain("type:'selectstart',handPinch:true"); expect(pe).toContain("type:'selectend',handPinch:true");
    expect(h.match(/pinchEdge\(c,hs,ev,now\)/g)).toHaveLength(2); // pinchStep (frame: after the isHand continue) and eventPose (returns first for a controller)
    expect(bodyAfter(hv, 'eventPose(c,e){')).toContain('if(e?.handPinch||');
  });
  it('the carried ray is written only in hand steps; tunables read once, guarded', () => {
    expect(hv).toContain("parsePinchTune(lsGet('vrl-hand-pinch'))"); expect(hv).toContain("parseDragTune(lsGet('vrl-hand-drag'))");
    expect(bodyAfter(hv, 'const lsGet=k=>')).toContain('try{return localStorage.getItem(k)}catch{return null}');
    expect(code(hv).match(/carryStep\(/g)).toHaveLength(1); // the call in frame()'s hand branch (after the isHand continue)
  });
});

describe('the joint aim ray is built only in a hand\'s tick (controllers untouched); the system ray stays the fallback', () => {
  const code = t => t.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  it('aimRay() is called once, inside tick (reached only from frame()\'s hand branch), behind the joint switch; the fallback path is the one', () => {
    const tk = bodyAfter(hv, 'const tick=(c,hs,now)=>{');
    expect(code(hv).match(/aimRay\(hs,c\)/g)).toHaveLength(1); expect(tk).toContain('const jr=aimOn?aimRay(hs,c):null;');
    expect(tk).toContain('hs.hist.push(now,r);'); expect(tk.indexOf('hs.hist.push(now,r);')).toBeLessThan(tk.indexOf('const jr=')); // the record is kept whatever ray is shown
    expect(tk).toContain("if(hs.src!=='sys'){hs.filter.reset();hs.src='sys'}"); expect(tk).toContain('const t=hs.hist.at(now-hs.delay,hs.del);hs.filter.filter(hs.del,t,hs.out);');
    expect(tk).toContain('hs.aim.filter(jr,now,hs.out);'); expect(tk).toContain('turnToward(hs.lastQ,0,hs.out,3,lim,hs.out,3);');
    expect(bodyAfter(hv, 'const aimRay=(hs,c)=>{')).toContain("joint(hs,'index-finger-phalanx-proximal')"); // the origin: the index knuckle
    expect(bodyAfter(hv, 'const aimRay=(hs,c)=>{')).toContain("joint(hs,'index-finger-metacarpal')||joint(hs,'wrist')");
    expect(hv).toContain("parseRayTune(lsGet('vrl-hand-ray'))");
    expect(bodyAfter(hv, 'const aimRay=(hs,c)=>{')).toContain('fingerAimPose(k,ak,td,tipMix,hs.jr);'); // the index finger's own axis
    expect(bodyAfter(hv, 'const aimRay=(hs,c)=>{')).toContain("if(!aimFinger){ak[0]=k[0];ak[1]=k[1];ak[2]=k[2];return aimRayPose(j,ak,hs.side,aimOff,hs.jr)}"); // axis 'metacarpal' =
    expect(code(hv).match(/fingerAimPose\(/g)).toHaveLength(1);
    expect(src.includes('aimRay')).toBe(false); expect(src.includes('vrl-hand-ray')).toBe(false); // nothing of it in vr-view.js
  });
});

describe('direct grab: hands only, the controller path is untouched', () => {
  it("the fist asks near() first; with a target the board / section / volume itself is taken, else the laser path (gripStart) runs as before", () => {
    const g = bodyAfter(hv, 'const grabStep=(c,hs,now)=>{');
    expect(g).toContain('hs.near=near?near(c,nearM):null;'); expect(g.indexOf('hs.near=near?near(c,nearM)')).toBeLessThan(g.indexOf('grab(c,hs.near)'));
    expect(g).toContain('hs.aFilter.reset();palm(hs,now);'); // the anchor starts at the palm: the held object keeps its offset
    expect(g).toContain('else hs.near=hs.grab.active||!near?null:near(c,nearM);');
    expect(bodyAfter(hv, 'frame(now){')).toContain('else hs.near=null;');
    expect(bodyAfter(hv, 'reach(c){').trimStart()).toMatch(/^return isHand\(c\.userData\.source\)\?/);
  });
  it('nearGrabTarget: never for a controller (holdOf(c)===c), only from the hand callback; the four boards keep the bodies of gripStart', () => {
    const n = bodyAfter(src, 'const nearGrabTarget=(c,nm)=>{');
    expect(n.trimStart().startsWith('const mine=holdOf(c);if(mine===c||!isHand(c.userData.source))return null;')).toBe(true);
    expect(n).toContain('return pickNearGrab(o,nm);');
    expect(src.match(/gripStartNear[(=]/g)).toHaveLength(2); // the definition and the hand callback
    expect(src.match(/nearGrabTarget[(=]/g)).toHaveLength(2); // the definition and the hand callback
    const st = bodyAfter(src, 'const gripStartNear=(c,t)=>{');
    for (const w of ['holdOf(c).attach(menu.mesh)', 'holdOf(c).attach(help.mesh)', 'holdOf(c).attach(hist.group)', 'holdOf(c).attach(huLine.panel)', 'grabbing.add(c);regrab();', 'startFistSection(c,t.ref)']) expect(st).toContain(w);
    expect(st).not.toMatch(/[^f(]c\.attach\(/); expect(st.trimEnd().endsWith('gripStart(c); // the object went away meanwhile: the laser decides, as before')).toBe(true);
  });
  it('the order of the candidates is the order of NEAR_KINDS (menu, help, hist, hu, section, volume)', () => {
    const n = bodyAfter(src, 'const nearGrabTarget=(c,nm)=>{');
    const at = ['o[0].d=boardDist(menu.mesh)', 'o[1].d=boardDist(help.mesh)', 'o[2].d=boardDist(hist.board)', 'o[3].d=boardDist(huLine.panel)', 'o[4].d=d', 'o[5].d=centeredBoxDist'].map(w => n.indexOf(w));
    expect(at.every(i => i >= 0)).toBe(true); expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('a fist-held section: the same drag record as a pinch (fist: true), driven by the palm anchor, ended by ungrab without a throw; moved only while no volume moves', () => {
    const f = bodyAfter(src, 'const startFistSection=(c,pl)=>{');
    expect(f).toContain('fist:true'); expect(f).toContain('anchorInHolder(c)'); expect(f).not.toContain('handInHolder(c)'); expect(f).toContain('draggedBy(pl,c)');
    const u = bodyAfter(src, 'const updateFistDrag=c=>{');
    expect(u.trimStart().startsWith('const dg=c.userData.drag;if(!dg||!dg.fist||!vrHalfExt)return;')).toBe(true);
    expect(u).toContain('if(twoHand||grabbing.has(c))'); expect(u).toContain('sectionFollowStep(');
    expect(src).toContain('updatePress(c,nowF);updateFistDrag(c);');
    expect(src).toContain('ungrab:c=>{if(c.userData.drag?.fist){endDrag(c);return}gripEnd(c)}');
    expect(lineOf(src, 'const anchorInHolder=c=>{')).toBeTruthy();
    expect(bodyAfter(src, 'const anchorInHolder=c=>{')).toContain('const a=holdOf(c);');
  });
  it('feedback: a section within reach glows in the hand colour (the existing glow), the fingertips turn green', () => {
    expect(src).toContain("nr=handIn.reach(c)"); expect(src).toContain("(nr?.kind==='section'?nr.ref:null)");
    expect(hv).toContain('REACH_TIP=0x39ff6a'); expect(hv).toContain('hs?.near?REACH_TIP');
    expect(hv.indexOf('hs?.grab.active?GRAB_TIP')).toBeLessThan(hv.indexOf('hs?.near?REACH_TIP')); // holding (orange) wins over reach (green)
  });
  it('the tunables are read once, from localStorage guarded by try/catch', () => {
    expect(hv).toContain("parseGrabTune(lsGet('vrl-hand-grab'))"); expect(hv).toContain("parseFilterTune(lsGet('vrl-hand-filter'))");
    expect(lineOf(hv, 'const lsGet=')).toContain('try{return localStorage.getItem(k)}catch{return null}');
  });
});

describe('nearGrabTarget run from its own source (units, scales, priorities)', () => {
  // the block from the temporaries to the end of nearGrabTarget, run against stand-ins for the closure variables of vr-view.js
  const a = src.indexOf('const tmpNp=new THREE.Vector3()'), b = src.indexOf('const startFistSection=(c,pl)=>{');
  expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
  const code = src.slice(a, b) + '\nreturn nearGrabTarget;';
  const plane = (w, h, at) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h)); m.position.copy(at); m.updateMatrixWorld(true); return m; };
  const make = () => {
    const holder = new THREE.Group(); holder.scale.setScalar(0.1); holder.position.set(0, 1.3, -0.5); holder.updateMatrixWorld(true); // app units -> metres: 1 unit = 10 cm
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)); holder.add(mesh); holder.updateMatrixWorld(true);
    const palm = new THREE.Object3D(), ctrl = { userData: { source: { hand: {} } } };
    const x = {
      THREE, isHand: s => !!(s && s.hand), NEAR_KINDS, pickNearGrab, boxDist, centeredBoxDist, squareOutlineDist,
      holdOf: c => (c === ctrl ? palm : c), ui: { open: false }, menuHeld: null, helpHeld: null, histHeld: null, huHeld: null,
      menu: { mesh: plane(0.5, 0.3, new THREE.Vector3(0.8, 1.3, -0.5)) }, help: { mesh: plane(0.4, 0.3, new THREE.Vector3(-0.8, 1.3, -0.5)) },
      hist: { isOpen: false, group: new THREE.Group(), board: plane(0.4, 0.3, new THREE.Vector3(0, 2, -0.5)) },
      huLine: { panel: plane(0.3, 0.2, new THREE.Vector3(0, 0.5, -0.5)), isDragging: () => false },
      vrHalfExt: [1, 1, 1], section: { on: false }, planes: [], draggedBy: () => false, mesh,
    };
    x.menu.mesh.visible = false; x.help.mesh.visible = false; x.huLine.panel.visible = false;
    x.near = new Function('ctx', 'with(ctx){' + code + '}')(x);
    return { x, palm, ctrl, holder, mesh, at: (px, py, pz, nm = 0.05) => { palm.position.set(px, py, pz); palm.updateMatrixWorld(true); return x.near(ctrl, nm); } };
  };
  it('the volume: inside its box, or within 5 cm (world metres, whatever the volume scale) of it; farther: null (the laser decides)', () => {
    const { at } = make();
    expect(at(0, 1.3, -0.5).kind).toBe('volume'); // the middle
    expect(at(0.1, 1.3, -0.5).kind).toBe('volume'); // exactly on the face (1 unit = 10 cm)
    expect(at(0.14, 1.3, -0.5).kind).toBe('volume'); // 4 cm outside
    expect(at(0.16, 1.3, -0.5)).toBe(null); // 6 cm outside
  });
  it("a controller (holdOf(c) is c) never gets a target", () => {
    const { x, ctrl } = make(); x.holdOf = c => c;
    expect(x.near(ctrl, 0.05)).toBe(null);
  });
  it('a board in reach wins over the volume it overlaps; a closed / held board is no candidate', () => {
    const { x, at } = make();
    x.menu.mesh.position.set(0.05, 1.3, -0.5); x.menu.mesh.updateMatrixWorld(true);
    expect(at(0.05, 1.3, -0.46).kind).toBe('volume'); // the menu is closed
    x.ui.open = true; x.menu.mesh.visible = true;
    expect(at(0.05, 1.3, -0.46).kind).toBe('menu'); // 4 cm in front of the open menu, inside the volume box too
    expect(at(0.05, 1.3, -0.30)).toBe(null); // 20 cm from the menu and 10 cm outside the volume box
    x.menuHeld = {}; expect(at(0.05, 1.3, -0.46).kind).toBe('volume');
  });
  it('a section frame: the thin outline / the number tag within 5 cm wins over the volume; the middle of its face does not', () => {
    const { x, holder, at } = make();
    const obj = new THREE.Group(), handle = new THREE.Object3D(); handle.position.set(0, 0.15, 0.15); obj.add(handle); holder.add(obj); obj.position.set(0, 0, 0); holder.updateMatrixWorld(true);
    const pl = { obj, handle, h: 0.12 }; x.planes.push(pl); x.section.on = true;
    obj.scale.setScalar(10); holder.updateMatrixWorld(true); // the frame at its design size: world scale 0.1 x 10 = 1, so 12 cm half side in the world
    const w = (y, z, xx = 0) => { const v = new THREE.Vector3(xx, y, z); obj.localToWorld(v); return v; };
    let p = w(0.12, 0); expect(at(p.x, p.y, p.z)).toMatchObject({ kind: 'section' }); expect(at(p.x, p.y, p.z).ref).toBe(pl); // on the edge (inside the volume box too)
    p = w(0, 0); expect(at(p.x, p.y, p.z).kind).toBe('volume'); // the middle of the face: 12 cm from the outline
    p = w(0.12 - 0.03, 0); expect(at(p.x, p.y, p.z).kind).toBe('section'); // 3 cm inside the edge
    p = w(0.12 - 0.08, 0); expect(at(p.x, p.y, p.z).kind).toBe('volume'); // 8 cm inside the edge
    x.section.on = false; p = w(0.12, 0); expect(at(p.x, p.y, p.z).kind).toBe('volume'); // sections hidden: not a candidate
    x.section.on = true; x.draggedBy = () => true; expect(at(p.x, p.y, p.z).kind).toBe('volume'); // held by the other hand
  });
  it('the reach follows the tuned near (vrl-hand-grab near)', () => {
    const { at } = make();
    expect(at(0.18, 1.3, -0.5, 0.05)).toBe(null); expect(at(0.18, 1.3, -0.5, 0.1).kind).toBe('volume');
  });
});

describe('disconnect releases everything the input held', () => {
  const body = bodyAfter(src, "c.addEventListener('disconnected',c.userData.release=e=>{");
  // run the handler's own text with stand-ins for vr-view's closure variables (sloppy-mode `with`: assignments land on ctx)
  const run = (ctx, e) => new Function('ctx', 'e', 'with(ctx){' + body + '}')(ctx, e);
  const make = c => {
    const attach = vi.fn();
    return {
      c, attach, endDrag: vi.fn(), huLine: { cancelDragOf: vi.fn(), panel: {} }, wheelOwner: null, closeWheel: vi.fn(), pw: null, closePointWheel: vi.fn(),
      histAxis: null, histAxisEnd: vi.fn(), histHeld: null, hist: { group: {} }, huHeld: null, scene: { attach },
      grabbing: new Set(), regrab: vi.fn(), menuHeld: null, menu: { mesh: { n: 'menu' } }, helpHeld: null, help: { mesh: { n: 'help' }, refresh: vi.fn() },
      dragging: null, saveSettings: vi.fn(), settings: {}, ring: { parent: null, visible: true }, handIn: { drop: vi.fn() },
    };
  };
  const ctrl = () => ({ userData: { source: { handedness: 'left', gamepad: {} }, press: {}, drag: {}, res: { kind: 'point' }, bDown: true, axPress: { reset: vi.fn() }, stickLock: true } });
  it('a volume held by one hand is let go (regrab), the menu / help it held stay where they are, a slider drag ends', () => {
    const c = ctrl(), x = make(c), other = {};
    x.grabbing.add(c); x.menuHeld = c; x.helpHeld = other; x.dragging = { c, i: 3 }; x.ring.parent = c;
    run(x);
    expect(x.grabbing.has(c)).toBe(false); expect(x.regrab).toHaveBeenCalledTimes(1);
    expect(x.menuHeld).toBe(null); expect(x.attach).toHaveBeenCalledWith(x.menu.mesh);
    expect(x.helpHeld).toBe(other); expect(x.attach).not.toHaveBeenCalledWith(x.help.mesh);
    expect(x.dragging).toBe(null); expect(x.saveSettings).toHaveBeenCalled();
    expect(x.ring.visible).toBe(false); expect(c.userData.bDown).toBe(false); expect(c.userData.res).toBe(null); expect(c.userData.press).toBe(null);
    expect(c.userData.source).toBe(null); expect(x.endDrag).toHaveBeenCalledWith(c); expect(x.huLine.cancelDragOf).toHaveBeenCalledWith(c);
    expect(x.handIn.drop).not.toHaveBeenCalled(); // a controller: no hand state
  });
  it('two-hand scaling: the other hand keeps the volume (regrab with one hand left)', () => {
    const c = ctrl(), o = {}, x = make(c); x.grabbing.add(c); x.grabbing.add(o); x.helpHeld = c;
    run(x);
    expect([...x.grabbing]).toEqual([o]); expect(x.regrab).toHaveBeenCalledTimes(1);
    expect(x.helpHeld).toBe(null); expect(x.attach).toHaveBeenCalledWith(x.help.mesh);
  });
  it('nothing held: no regrab, nothing attached', () => {
    const c = ctrl(), x = make(c); x.grabbing.add({});
    run(x);
    expect(x.regrab).not.toHaveBeenCalled(); expect(x.attach).not.toHaveBeenCalled(); expect(x.grabbing.size).toBe(1);
  });
  it("a hand's tracking-loss cancel (release(true)) releases the same but keeps the input source; a hand's disconnect drops its state", () => {
    const c = ctrl(); c.userData.hs = {}; const x = make(c); x.grabbing.add(c);
    run(x, true);
    expect(x.grabbing.size).toBe(0); expect(c.userData.source).not.toBe(null); expect(x.handIn.drop).not.toHaveBeenCalled();
    run(x);
    expect(c.userData.source).toBe(null); expect(x.handIn.drop).toHaveBeenCalledWith(c); expect(x.help.refresh).toHaveBeenCalled();
  });
});

// 体験会モード x hands: the help board keeps the mission block AND switches to the hand wording
describe('help board: event-mode mission + hand wording together', () => {
  const draw = src.slice(src.indexOf('help.onDraw(()=>{'), src.indexOf('return w;', src.indexOf('help.onDraw(()=>{')));
  it('draws the mission block and uses hand lines when a hand is the input', () => {
    expect(draw).toContain('handIn.anyHand()?handIn.texts:null');
    expect(draw).toContain('if(evH){');
    expect(draw).toContain('y:60+evH');
    expect(draw).toContain('140+evH+i*HELP_LINE_PITCH');
  });
  it('the かんたん menu (tab 10, buttons only) gets the no-slider hand line, and the board redraws when it opens', () => {
    expect(draw).toContain('ui.tab===10?hx.helpMenuSimple:hx.helpMenu');
    expect(src).toContain('[section.on,ui.open,ui.open&&ui.tab===10].join()');
  });
});
