import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BUTTON_SPOTS, hintArrows, pulse01, bob01, boardSide, edgeArrowShown, EDGE_ARROW_DEG, buildControllerModel, poseHint, createControllerHints, createEdgeArrow, createBoardArrow } from '../../docs/tutorial-3d.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';
import { readFileSync } from 'node:fs';

// the 3D controller with the button blinking + an arrow, the direction arrow at the edge of the view, the arrow over the menu's button
describe('hints: which arrows for which button', () => {
  it('every button a page names has a spot on the model; trigger / grip / face come from outside, the stick has the tilt, press and hold forms', () => {
    for (const s of TUTORIAL_MISSIONS.flatMap(m => m.steps)) { expect(BUTTON_SPOTS[s.ctl.btn], s.id).toBeTruthy(); expect(hintArrows(s.ctl).length, s.id).toBeGreaterThan(0); }
    expect(hintArrows({ btn: 'trigger' })).toHaveLength(1); expect(hintArrows({ btn: 'grip' })).toHaveLength(1); expect(hintArrows({ btn: 'face' })).toHaveLength(1);
    const ud = hintArrows({ btn: 'stick', motion: 'updown' }); expect(ud).toHaveLength(2); expect(ud[0].from[2]).toBeLessThan(0); expect(ud[1].from[2]).toBeGreaterThan(0); // from ahead and from behind: the tilt
    expect(hintArrows({ btn: 'stick', motion: 'press' })[0]).toMatchObject({ still: false }); expect(hintArrows({ btn: 'stick', motion: 'hold' })[0]).toMatchObject({ still: true, bob: 0 }); // press bobs, hold stays down
    expect(hintArrows(null)).toEqual([]); expect(hintArrows({ btn: 'nope' })).toEqual([]);
    for (const a of [...ud, ...hintArrows({ btn: 'trigger' })]) expect(Math.hypot(...a.from)).toBeCloseTo(1, 6);
  });
  it('pulse / bob are 0..1 and periodic', () => {
    for (const t of [0, 123, 456, 999]) { expect(pulse01(t)).toBeGreaterThanOrEqual(0); expect(pulse01(t)).toBeLessThanOrEqual(1); expect(bob01(t)).toBeGreaterThanOrEqual(0); expect(bob01(t)).toBeLessThanOrEqual(1); }
    expect(pulse01(0)).toBeCloseTo(1); expect(pulse01(500)).toBeCloseTo(0); expect(pulse01(1000)).toBeCloseTo(1); expect(bob01(0)).toBeCloseTo(0); expect(bob01(400)).toBeCloseTo(1);
  });
});
describe('the controller model', () => {
  it('is made of own shapes only (no file, no network, no CDN), disposes cleanly', () => {
    const src = readFileSync(new URL('../../docs/tutorial-3d.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\b(fetch|XMLHttpRequest|import\s*\(|GLTFLoader|TextureLoader|https?:\/\/)/); expect(src).not.toMatch(/^import /m);
    const m = buildControllerModel(THREE); expect(m.group.children.length).toBeGreaterThan(3); let meshes = 0; m.group.traverse(o => { if (o.isMesh) meshes++; }); expect(meshes).toBeGreaterThan(8);
    expect(() => m.group.userData.dispose()).not.toThrow();
  });
  it('the blinking ring sits on the named button and pulses; the arrow points at it from the outside and bobs; unknown spec hides both', () => {
    const m = buildControllerModel(THREE);
    for (const btn of ['trigger', 'grip', 'face', 'stick']) {
      expect(poseHint(THREE, m, { btn }, 0)).toBe(true); expect(m.ring.visible).toBe(true);
      expect([m.ring.position.x, m.ring.position.y, m.ring.position.z]).toEqual(BUTTON_SPOTS[btn].p);
      const a = m.arrows[0]; expect(a.visible).toBe(true);
      const far = a.position.distanceTo(new THREE.Vector3(...BUTTON_SPOTS[btn].p)); expect(far).toBeGreaterThan(0.02); expect(far).toBeLessThan(0.07);
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(a.quaternion), toBtn = new THREE.Vector3(...BUTTON_SPOTS[btn].p).sub(a.position).normalize(); expect(dir.dot(toBtn)).toBeGreaterThan(0.99); // the tip leads towards the button
    }
    poseHint(THREE, m, { btn: 'trigger' }, 0); const near0 = m.arrows[0].position.clone(); poseHint(THREE, m, { btn: 'trigger' }, 400); expect(m.arrows[0].position.distanceTo(near0)).toBeGreaterThan(0.005); // bobs
    poseHint(THREE, m, { btn: 'trigger' }, 0); const s0 = m.ring.scale.x; poseHint(THREE, m, { btn: 'trigger' }, 500); expect(m.ring.scale.x).toBeGreaterThan(s0); // the ring pulses (smallest at the start of a period, widest half way)
    poseHint(THREE, m, { btn: 'stick', motion: 'updown' }, 0); expect(m.arrows.every(a => a.visible)).toBe(true); poseHint(THREE, m, { btn: 'stick', motion: 'hold' }, 0); expect(m.arrows[0].visible).toBe(true); expect(m.arrows[1].visible).toBe(false);
    const h0 = m.arrows[0].position.clone(); poseHint(THREE, m, { btn: 'stick', motion: 'hold' }, 400); expect(m.arrows[0].position.distanceTo(h0)).toBe(0); // held: still
    expect(poseHint(THREE, m, null, 0)).toBe(false); expect(m.ring.visible).toBe(false); expect(m.arrows.some(a => a.visible)).toBe(false);
  });
  it('the left hand is the mirror of the right hand (the face button / grip are on the other side)', () => {
    expect(BUTTON_SPOTS.face.p[0]).toBeGreaterThan(0); expect(BUTTON_SPOTS.grip.p[0]).toBeLessThan(0);
    const scene = new THREE.Scene(), c = [new THREE.Group(), new THREE.Group()]; c[0].userData.source = { handedness: 'right' }; c[1].userData.source = { handedness: 'left' }; c.forEach(x => scene.add(x));
    const hints = createControllerHints(THREE, { controllers: c }); hints.update(0, { btn: 'face' });
    const wx = (ctl) => { const g = ctl.children[0]; ctl.updateMatrixWorld(true); return new THREE.Vector3(...BUTTON_SPOTS.face.p).applyMatrix4(g.matrixWorld).x; };
    expect(wx(c[0])).toBeGreaterThan(0); expect(wx(c[1])).toBeLessThan(0); hints.dispose();
  });
});
describe('createControllerHints: both controllers, hidden without a spec, nothing on a tracked hand', () => {
  const mk = (hand = false) => { const scene = new THREE.Scene(), c = [new THREE.Group(), new THREE.Group()]; c.forEach((x, i) => { x.userData.source = { handedness: i ? 'left' : 'right' }; scene.add(x); });
    return { c, hints: createControllerHints(THREE, { controllers: c, isHand: src => hand && src.handedness === 'left' }) }; };
  it('shown on both controllers while a spec is given, hidden with none; built on first use', () => {
    const { c, hints } = mk(); expect(hints.count).toBe(0); hints.update(0, null); expect(hints.count).toBe(0);
    hints.update(0, { btn: 'trigger' }); expect(hints.count).toBe(2); expect(c.every(x => x.children[0].visible)).toBe(true);
    hints.update(100, null); expect(c.every(x => !x.children[0].visible)).toBe(true); hints.update(200, { btn: 'grip' }); expect(c.every(x => x.children[0].visible)).toBe(true);
    hints.dispose(); expect(c.every(x => x.children.length === 0)).toBe(true);
  });
  it('a hand-tracked controller shows nothing (no buttons); a disconnected one (visible false) neither', () => {
    const { c, hints } = mk(true); hints.update(0, { btn: 'trigger' }); expect(c[0].children[0].visible).toBe(true); expect(c[1].children.length === 0 || !c[1].children[0].visible).toBe(true);
    c[0].visible = false; hints.update(10, { btn: 'trigger' }); expect(c[0].children[0].visible).toBe(false);
  });
});
describe('the direction arrow at the edge of the view', () => {
  it('boardSide: +1 left / -1 right of the gaze, with the angle; shown only well out of the central view', () => {
    // head looks to -z; left of it is -x (vr-view.js headLeft = (fwd.z, -fwd.x) = (-1, 0))
    const L = [-1, 0], g = [0, -1];
    const left = boardSide(g[0], g[1], L[0], L[1], -Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)); expect(left.side).toBe(1); expect(left.deg).toBeCloseTo(60, 6);
    const right = boardSide(g[0], g[1], L[0], L[1], Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)); expect(right.side).toBe(-1);
    expect(boardSide(0, 0, 1, 0, 1, 1)).toBeNull();
    expect(edgeArrowShown(EDGE_ARROW_DEG + 1)).toBe(true); expect(edgeArrowShown(EDGE_ARROW_DEG)).toBe(false); expect(edgeArrowShown(0)).toBe(false); expect(edgeArrowShown(null)).toBe(false);
    expect(EDGE_ARROW_DEG).toBeLessThan(36); // a board 50 deg out (inner edge 34.5 deg) is flagged as out of view while the gaze is straight ahead
  });
  it('the arrow sits in front of the head towards the board\'s side, faces the head, points at that side and bobs; hidden when not shown', () => {
    const a = createEdgeArrow(THREE), head = new THREE.Vector3(0, 1.6, 0), gaze = new THREE.Vector3(0, 0, -1), left = new THREE.Vector3(-1, 0, 0);
    a.update(0, null); expect(a.mesh.visible).toBe(false);
    a.update(0, { show: true, side: 1, head, gaze, left }); expect(a.mesh.visible).toBe(true);
    expect(a.mesh.position.x).toBeLessThan(-0.2); expect(a.mesh.position.z).toBeCloseTo(-0.7, 1); // to the left, 0.7 m ahead
    const tipDir = new THREE.Vector3(1, 0, 0).applyQuaternion(a.mesh.quaternion); expect(tipDir.x).toBeLessThan(-0.9); // the tip (+x of the shape) points left
    a.update(0, { show: true, side: -1, head, gaze, left }); expect(a.mesh.position.x).toBeGreaterThan(0.2); expect(new THREE.Vector3(1, 0, 0).applyQuaternion(a.mesh.quaternion).x).toBeGreaterThan(0.9);
    const x0 = a.mesh.position.x; a.update(350, { show: true, side: -1, head, gaze, left }); expect(a.mesh.position.x).not.toBeCloseTo(x0, 3); // bobs
    a.update(0, { show: false }); expect(a.mesh.visible).toBe(false); expect(() => a.dispose()).not.toThrow();
  });
});
describe('the arrow over the menu', () => {
  const W = 1024, H = 1180, widthM = 0.5, s = widthM / W;
  it('a child of the board; its tip is above / below the rect (a gap that bobs), pointing at it, in front of the board; hidden without a rect', () => {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(widthM, widthM * H / W)), b = createBoardArrow(THREE, board);
    expect(b.mesh.parent).toBe(board); b.update(0, null); expect(b.mesh.visible).toBe(false);
    const rect = { x: 710, y: 180, w: 250, h: 72 };
    b.update(0, { rect, from: 'top', W, H, widthM }); expect(b.mesh.visible).toBe(true);
    expect(b.mesh.position.x).toBeCloseTo((710 + 125 - W / 2) * s, 6); expect(b.mesh.position.z).toBeGreaterThan(0.005); // over the button's centre, in front
    const tipY0 = b.mesh.position.y, rectTopY = (H / 2 - 180) * s; expect(tipY0).toBeGreaterThan(rectTopY); // above the button's top edge
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(b.mesh.quaternion); expect(dir.y).toBeLessThan(-0.99); // pointing down at it
    b.update(350, { rect, from: 'top', W, H, widthM }); expect(b.mesh.position.y).toBeGreaterThan(tipY0); // the gap grows and shrinks: it moves
    b.update(0, { rect: { x: 440 + 139, y: 436, w: 52, h: 52 }, from: 'bottom', W, H, widthM }); expect(new THREE.Vector3(0, 1, 0).applyQuaternion(b.mesh.quaternion).y).toBeGreaterThan(0.99); expect(b.mesh.position.y).toBeLessThan((H / 2 - 488) * s); // below the knob, pointing up
    b.update(0, { rect, from: 'left', W, H, widthM }); expect(new THREE.Vector3(0, 1, 0).applyQuaternion(b.mesh.quaternion).x).toBeGreaterThan(0.99);
    b.dispose(); expect(b.mesh.parent).toBeNull();
  });
});

describe('review fixes', () => {
  it('no tracking ring: a Quest 3 (Touch Plus) controller has none (the only torus is the blinking highlight ring)', () => {
    const m = buildControllerModel(THREE); const tori = []; m.group.traverse(o => { if (o.isMesh && o.geometry.type === 'TorusGeometry') tori.push(o); });
    expect(tori).toEqual([m.ring]);
  });
  it('facelow = A / X (the lower face button): another spot than B / Y, on the same side, used for the held press that opens the menu', () => {
    expect(BUTTON_SPOTS.facelow).toBeTruthy(); expect(BUTTON_SPOTS.facelow.p).not.toEqual(BUTTON_SPOTS.face.p); expect(BUTTON_SPOTS.facelow.p[0]).toBeGreaterThan(0);
    const h = hintArrows({ btn: 'facelow', motion: 'hold' }); expect(h).toHaveLength(1); expect(h[0].still).toBe(true); expect(h[0].bob).toBe(0);
    const m = buildControllerModel(THREE); poseHint(THREE, m, { btn: 'facelow', motion: 'hold' }, 0); expect(m.ring.visible).toBe(true); expect([m.ring.position.x, m.ring.position.y, m.ring.position.z]).toEqual(BUTTON_SPOTS.facelow.p);
  });
  it('a hint can be limited to one hand (spec.hand); without it both hands show it', () => {
    const scene = new THREE.Scene(), c = [new THREE.Group(), new THREE.Group()]; c[0].userData.source = { handedness: 'right' }; c[1].userData.source = { handedness: 'left' }; c.forEach(x => scene.add(x));
    const hints = createControllerHints(THREE, { controllers: c });
    hints.update(0, { btn: 'trigger', hand: 'right' }); expect(c[0].children[0].visible).toBe(true); expect(c[1].children.length === 0 || !c[1].children[0].visible).toBe(true);
    hints.update(10, { btn: 'trigger', hand: 'left' }); expect(c[0].children[0].visible).toBe(false); expect(c[1].children[0].visible).toBe(true);
    hints.update(20, { btn: 'trigger' }); expect(c.every(x => x.children[0].visible)).toBe(true); hints.dispose();
  });
  it('nothing is allocated per frame: the arrow tables are shared, poseHint / the edge arrow / the menu arrow create no vectors, quaternions or arrays after the first frame', () => {
    expect(hintArrows({ btn: 'stick', motion: 'updown' })).toBe(hintArrows({ btn: 'stick', motion: 'updown' })); expect(hintArrows({ btn: 'grip' })).toBe(hintArrows({ btn: 'grip' })); expect(Object.isFrozen(hintArrows({ btn: 'grip' }))).toBe(true);
    let made = 0; const count = C => class extends C { constructor(...a) { super(...a); made++; } };
    const T = { ...THREE, Vector3: count(THREE.Vector3), Quaternion: count(THREE.Quaternion), Euler: count(THREE.Euler), Matrix4: count(THREE.Matrix4) };
    const m = buildControllerModel(T), edge = createEdgeArrow(T), board = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5)), ba = createBoardArrow(T, board);
    const head = new THREE.Vector3(0, 1.6, 0), gaze = new THREE.Vector3(0, 0, -1), left = new THREE.Vector3(-1, 0, 0);
    const frame = t => { for (const spec of [{ btn: 'trigger' }, { btn: 'stick', motion: 'updown' }, { btn: 'stick', motion: 'hold' }, { btn: 'facelow', motion: 'hold' }]) poseHint(T, m, spec, t); edge.update(t, { show: true, side: 1, head, gaze, left }); ba.update(t, { rect: { x: 10, y: 10, w: 50, h: 20 }, from: 'top', W: 1024, H: 1180, widthM: 0.5 }); };
    frame(0); const before = made; for (let t = 16; t < 2000; t += 16) frame(t);
    expect(made - before).toBe(0);
  });
});
