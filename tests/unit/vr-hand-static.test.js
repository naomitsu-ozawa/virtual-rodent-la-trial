import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// build 625: hand tracking. vr-view.js / vr-hand-view.js are WebXR files (not run in node): the guards are checked on the source, and the
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
  it('the grip is ignored for a hand (phase 1), first thing in squeezestart', () => {
    const b = bodyAfter(src, "c.addEventListener('squeezestart',()=>{");
    expect(b.trimStart().startsWith('if(isHand(c.userData.source))return;')).toBe(true);
    expect(b).toContain('grabbing.add(c)');
  });
  it("the hand's select pre-hook runs before vr-view's own select handlers and only re-applies a hand's pose", () => {
    const pre = src.indexOf("for(const t of ['selectstart','selectend'])c.addEventListener(t,()=>handIn.eventPose(c))");
    expect(pre).toBeGreaterThan(0);
    expect(pre).toBeLessThan(src.indexOf("c.addEventListener('selectstart',()=>{"));
    expect(bodyAfter(hv, 'eventPose(c){')).toMatch(/^if\(!isHand\(c\.userData\.source\)\)return;/);
  });
  it('drag thresholds: a hand uses its own (handIn.dragTh) behind isHand(); a controller keeps pr.dragRec?DRAG_RECORD:undefined', () => {
    expect(lineOf(src, 'const th=')).toContain('const th=isHand(c.userData.source)?handIn.dragTh(c,pr):(pr.dragRec?DRAG_RECORD:undefined);');
    expect(lineOf(src, 'HAND_LABEL_MOVE_M:0.008')).toContain('(isHand(c.userData.source)?HAND_LABEL_MOVE_M:0.008)');
  });
  it('every other handIn / wrist use in vr-view.js is behind isHand() or comes from a hand-only call', () => {
    const own = ['import ', 'const handIn=createHandInput(', "session.addEventListener('end',()=>handIn.dispose()", "for(const t of ['selectstart','selectend'])"];
    const handOnlyApi = ['handIn.frame(', 'handIn.wristHit(', 'handIn.hover(', 'handIn.wristId(', 'handIn.anyHand()', 'handIn.drop(c)', 'handIn.connect(', 'handIn.flash(', 'handIn.dragTh('];
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

describe('disconnect releases everything the input held (build 625 fix, controllers too)', () => {
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
    expect(draw).toContain('140+evH+i*78');
  });
  it('the かんたん menu (tab 10, buttons only) gets the no-slider hand line, and the board redraws when it opens', () => {
    expect(draw).toContain('ui.tab===10?hx.helpMenuSimple:hx.helpMenu');
    expect(src).toContain('[section.on,ui.open,ui.open&&ui.tab===10].join()');
  });
});
