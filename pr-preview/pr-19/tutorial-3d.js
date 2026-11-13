// the tutorial's 3D guides. THREE is injected (this module imports nothing): unit-tested with the real three in node (tests/unit/tutorial-3d.test.js).
//  1. a simple controller model (own shapes: no file, no CDN, no licence question) that sits on each controller while a step names a button (step.ctl); the button blinks (a pulsing ring)
//     and an arrow moves toward it (trigger / grip / the upper face button B or Y / the stick: tilt, short press, press and hold). It is drawn over the hand, hidden otherwise;
//  2. the direction arrow at the edge of the view that points to the board of the step (the left menu) while that board is out of view;
//  3. the arrow that moves over the button / the slider knob of the menu (a mesh in front of the board: no canvas redraw).
// Right-hand model; the left hand is its mirror (scale.x = -1). The annotations (ring + arrows) are children of the controller's GRIP space (renderer.xr.getControllerGrip), whose frame is the one the
// real controller model (@webxr-input-profiles/assets meta-quest-touch-plus, right.glb; left.glb is its exact x mirror) is authored in: metres, +x = the right hand's right (the palm / grip button side is -x),
// the handle runs along z with the head (buttons, stick, trigger) towards -z, the thumb side is +y and the trigger side is -y. BUTTON_SPOTS are measured from that glb (see the comment there).
export const PINK = 0xE8508F, GOLD = 0xffd27a;
// The model is drawn in its own frame F (handle hanging down along -y, ahead = -z), then tilted by TILT about x and moved to the ray's start: the handle goes down and back from the ray, the
// way a held controller sits (that hidden body F keeps its own ray-space numbers: nothing is drawn from it). BUTTON_SPOTS are in the GRIP space (what the arrows and the ring use): p = the button, from = the side an arrow comes from (a unit-ish vector from the button outwards).
export const TILT = -0.6, ORIGIN = [0, 0.012, 0.03];
const toAim = (p) => { const c = Math.cos(TILT), s = Math.sin(TILT); return [p[0] + ORIGIN[0], p[1] * c - p[2] * s + ORIGIN[1], p[1] * s + p[2] * c + ORIGIN[2]]; };
const dirAim = (v) => { const c = Math.cos(TILT), s = Math.sin(TILT); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };
const spot = (pMm, from) => Object.freeze({ p: Object.freeze(pMm.map(x => +(x / 1000).toFixed(5))), from: Object.freeze(from) }); // p in mm (as read from the glb) -> metres
// Measured on the right controller of meta-quest-touch-plus (glb vertices, grip space, mm): the face buttons (A, B) and the stick sit on one sloped face whose outward normal is n = (0, 0.8, -0.6)
// (the button press travel of the glb is (0, -0.83, +0.55)); the ring is on the top of each button / the stick cap. The trigger's finger surface faces (0, -0.8, -0.6) and the grip button (squeeze) faces -x.
// The stick is on the outer (+x) side of the right controller, A / B and the grip button are on the inner (-x) side. The arrows of the face buttons lean a little away from the stick (-x).
export const BUTTON_SPOTS = Object.freeze({
  trigger: spot([-9.5, -31.5, -23.2], [0, -0.8, -0.6]),  // the finger surface of the trigger (the index finger comes from below / ahead)
  grip: spot([-11.5, -1.5, 15.5], [-1, 0, 0]),           // the outer face of the grip button (the middle finger), on the palm side
  face: spot([-12.5, 3.3, -28.9], [-0.3, 0.8, -0.6]),    // B (right) / Y (left): the upper (front) of the two face buttons
  facelow: spot([-1.9, 11.0, -18.8], [-0.3, 0.8, -0.6]), // A (right) / X (left): the lower (back) one (a long press opens the menu)
  stick: spot([9.0, 3.5, -36.0], [0, 0.8, -0.6]),        // the top of the thumbstick cap
});
// the arrows of a hint {btn, motion?}: [{from: [x,y,z] unit vector, gap (m), bob (m), still}]. 'updown' = two arrows along the stick's tilt axis, 'press' = from above, 'hold' = from the button's side, held (no bob).
// The tables are built once (a frame must not allocate): the same frozen array comes back for the same spec.
const unit = v => { const l = Math.hypot(...v) || 1; return Object.freeze(v.map(x => x / l)); };
const arrowTable = new Map();
const NONE = Object.freeze([]);
export function hintArrows(spec) {
  if (!spec || !BUTTON_SPOTS[spec.btn]) return NONE;
  const key = spec.btn + '|' + (spec.motion || ''); let t = arrowTable.get(key); if (t) return t;
  const f = BUTTON_SPOTS[spec.btn].from, mk = (from, gap, bob, still) => Object.freeze({ from: unit(from), gap, bob, still });
  if (spec.btn === 'stick' && spec.motion === 'updown') t = [mk([0, -0.4, -0.95], 0.03, 0.014, false), mk([0, 0.8, 0.65], 0.03, 0.014, false)]; // along the stick's tilt axis (in the sloped face: (0, 0.6, 0.8)) from ahead (-z) and from behind, lifted off the face
  else if (spec.motion === 'hold') t = [mk(f, 0.026, 0, true)];
  else t = [mk(f, 0.03, 0.012, false)];
  t = Object.freeze(t); arrowTable.set(key, t); return t;
}
// 0..1 pulse (1 at the start of each period) and the bob phase (0..1..0)
export const pulse01 = (tMs, periodMs = 1000) => 0.5 + 0.5 * Math.cos((tMs / periodMs) * 2 * Math.PI);
export const bob01 = (tMs, periodMs = 800) => 0.5 - 0.5 * Math.cos((tMs / periodMs) * 2 * Math.PI);
// the side a board is on, from the head: gaze (gx, gz) and the left vector (lx, lz) of the head, d = the direction head -> board (dx, dz); {side: +1 left / -1 right, deg: the angle from the gaze}
export function boardSide(gx, gz, lx, lz, dx, dz) {
  const a = Math.hypot(gx, gz), b = Math.hypot(dx, dz); if (!(a > 1e-6) || !(b > 1e-6)) return null;
  const c = (gx * dx + gz * dz) / (a * b), deg = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  return { side: (lx * dx + lz * dz) >= 0 ? 1 : -1, deg };
}
// the direction arrow shows while the board is more than this far (deg) from the gaze: roughly outside the central part of the view
export const EDGE_ARROW_DEG = 22;
export const edgeArrowShown = (deg) => deg != null && deg > EDGE_ARROW_DEG;

function arrowMesh(THREE, { color = GOLD, coneR = 0.007, coneH = 0.02, shaftR = 0.0028, shaftL = 0.022, order = 999 } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false });
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 14), mat); cone.position.y = -coneH / 2;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 10), mat); shaft.position.y = -coneH - shaftL / 2;
  cone.renderOrder = shaft.renderOrder = order; g.add(cone, shaft); // the tip is at the group's origin, the tail runs along -y; the group points along +y
  g.userData.dispose = () => { cone.geometry.dispose(); shaft.geometry.dispose(); mat.dispose(); };
  g.userData.mat = mat;
  return g;
}
// scratch vectors per THREE (nothing is allocated per frame)
const scratch = new WeakMap();
const tmp = THREE => { let t = scratch.get(THREE); if (!t) { t = { a: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1) }; scratch.set(THREE, t); } return t; };
function aim(THREE, group, dx, dy, dz) { const t = tmp(THREE); t.a.set(dx, dy, dz).normalize(); group.quaternion.setFromUnitVectors(t.up, t.a); }

// the controller model (right hand). parts: {ring (the blinking ring, moved to the button), arrows[]}
export function buildControllerModel(THREE) {
  const root = new THREE.Group(), disposers = [];
  const mat = (c, o = 1) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, toneMapped: false }); disposers.push(() => m.dispose()); return m; };
    // body in its own frame F (a group tilted into the ray space): the handle, the head, the stick, the two face buttons, the trigger, the grip button
  const F = new THREE.Group(); F.rotation.x = TILT; F.position.set(...ORIGIN); root.add(F);
  const addF = (geo, m, p, rot) => { const me = new THREE.Mesh(geo, m); me.position.set(...p); if (rot) me.rotation.set(...rot); disposers.push(() => geo.dispose()); F.add(me); return me; };
  addF(new THREE.CapsuleGeometry(0.0175, 0.075, 4, 14), mat(0x3d4955), [0, -0.05, 0]);          // handle
  addF(new THREE.BoxGeometry(0.042, 0.026, 0.052), mat(0x46535f), [0, 0.007, 0]);                  // head (the top of the body)
  addF(new THREE.CylinderGeometry(0.0085, 0.0085, 0.01, 12), mat(0x1c232a), [0.0, 0.0225, 0.014]); // stick base
  addF(new THREE.SphereGeometry(0.0125, 14, 10), mat(0x2b343d), [0.0, 0.029, 0.014]);             // stick cap
  addF(new THREE.CylinderGeometry(0.0062, 0.0062, 0.004, 12), mat(0x8fa0b0), [0.016, 0.0215, 0.012]); // A / X
  addF(new THREE.CylinderGeometry(0.0062, 0.0062, 0.004, 12), mat(0x8fa0b0), [0.014, 0.0215, -0.007]); // B / Y
  addF(new THREE.BoxGeometry(0.013, 0.026, 0.01), mat(0x2b343d), [0, -0.016, -0.0195], [0.15, 0, 0]);  // trigger
  addF(new THREE.BoxGeometry(0.005, 0.045, 0.02), mat(0x56677a), [-0.0185, -0.048, 0.0]);          // grip button
  F.visible = false; // the body is not drawn (only the ring + arrows annotate the real controller); it stays in the graph so nothing about the ring / arrow placement changes
  // the blinking ring (moved onto the named button) and its arrows
  const ringMat = mat(PINK); ringMat.transparent = true; ringMat.depthTest = false; ringMat.depthWrite = false;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0145, 0.0021, 8, 28), ringMat); ring.renderOrder = 998; disposers.push(() => ring.geometry.dispose());
  root.add(ring);
  const arrows = [arrowMesh(THREE), arrowMesh(THREE)]; for (const a of arrows) { root.add(a); a.visible = false; }
  ring.visible = false;
  root.userData.dispose = () => { for (const d of disposers) { try { d(); } catch { /* */ } } for (const a of arrows) a.userData.dispose(); };
  return { group: root, body: F, ring, arrows, ringMat };
}
// the axis the ring around a button faces (grip space)
const RING_AXIS = Object.freeze({ trigger: [0, -0.8, -0.6], grip: [1, 0, 0], default: [0, 0.8, -0.6] });
// poses ring + arrows for spec at time tMs (pure of the scene: only this model's parts move)
export function poseHint(THREE, model, spec, tMs) {
  const arrows = hintArrows(spec);
  if (!arrows.length) { model.ring.visible = false; for (const a of model.arrows) a.visible = false; return false; }
  const spot = BUTTON_SPOTS[spec.btn], k = pulse01(tMs), hold = spec.motion === 'hold';
  model.ring.visible = true; model.ring.position.set(spot.p[0], spot.p[1], spot.p[2]);
  { const t = tmp(THREE), ax = RING_AXIS[spec.btn] || RING_AXIS.default; t.a.set(ax[0], ax[1], ax[2]).normalize(); model.ring.quaternion.setFromUnitVectors(t.fwd, t.a); }
  model.ring.scale.setScalar(hold ? 1.2 : 1 + 0.55 * (1 - k)); model.ringMat.opacity = hold ? 1 : 0.35 + 0.65 * k;
  model.arrows.forEach((m, i) => {
    const a = arrows[i]; m.visible = !!a; if (!a) return;
    const b = a.still ? 0 : bob01(tMs, spec.btn === 'stick' && spec.motion === 'press' ? 700 : 800) * a.bob, off = a.gap + b;
    m.position.set(spot.p[0] + a.from[0] * off, spot.p[1] + a.from[1] * off, spot.p[2] + a.from[2] * off);
    aim(THREE, m, -a.from[0], -a.from[1], -a.from[2]); // points from the outside at the button
    m.userData.mat.opacity = a.still ? 1 : 0.55 + 0.45 * (1 - bob01(tMs, 800));
  });
  return true;
}
// one hint model per controller, a child of that controller's GRIP space (grips[i] = renderer.xr.getControllerGrip(i), in the scene; controllers[i] = the ray space of the same input, which carries the
// handedness). Without a grip pose (grip.visible false: three sets it from the pose) or without a grip nothing is shown. isHand(src): hand tracking (no controller buttons: nothing is shown).
// update(tMs, spec|null) every frame.
export function createControllerHints(THREE, { controllers = [], grips = [], isHand = () => false } = {}) {
  const hints = new Map(); // grip -> model
  function of(g) { let h = hints.get(g); if (!h) { h = buildControllerModel(THREE); h.group.visible = false; g.add(h.group); hints.set(g, h); } return h; }
  return {
    update(tMs, spec) {
      for (let i = 0; i < controllers.length; i++) {
        const c = controllers[i], g = grips[i], src = c.userData?.source, hd = src?.handedness;
        const want = !!g && !!spec && hintArrows(spec).length > 0 && g.visible !== false && !isHand(src) && (!spec.hand || spec.hand === hd); // spec.hand 'left' | 'right': that hand only (none: both)
        const h = g ? hints.get(g) : null;
        if (!want) { if (h) h.group.visible = false; continue; }
        const m = of(g); m.group.visible = true;
        m.group.scale.x = hd === 'left' ? -1 : 1;
        poseHint(THREE, m, spec, tMs);
      }
    },
    get count() { return hints.size; },
    groups: () => [...hints.values()].map(h => h.group), // (hidden in the VR screenshots)
    dispose() { for (const [g, h] of hints) { try { g.remove(h.group); h.group.userData.dispose(); } catch { /* */ } } hints.clear(); },
  };
}

// the direction arrow at the edge of the view: a flat chevron placed in front of the head towards the board's side, pointing at that side, bobbing
export function createEdgeArrow(THREE) {
  const shape = new THREE.Shape(); shape.moveTo(0.045, 0); shape.lineTo(-0.02, 0.05); shape.lineTo(-0.02, 0.022); shape.lineTo(-0.045, 0.022); shape.lineTo(-0.045, -0.022); shape.lineTo(-0.02, -0.022); shape.lineTo(-0.02, -0.05); shape.closePath();
  const mat = new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 1, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat); mesh.renderOrder = 1000; mesh.visible = false; mesh.frustumCulled = false;
  const v = new THREE.Vector3();
  return {
    mesh,
    // st = {show, side (+1 left / -1 right), head, gaze, left} (THREE.Vector3 each)
    update(tMs, st) {
      if (!st || !st.show) { mesh.visible = false; return; }
      mesh.visible = true;
      const b = bob01(tMs, 700) * 0.03;
      v.copy(st.head).addScaledVector(st.gaze, 0.7).addScaledVector(st.left, st.side * (0.26 + b));
      mesh.position.copy(v); mesh.lookAt(st.head); mesh.rotateZ(st.side > 0 ? Math.PI : 0); // lookAt: +z to the head, +x to the viewer's right; the tip points to the board's side
      mesh.scale.setScalar(0.9 + 0.25 * pulse01(tMs, 700)); mat.opacity = 0.55 + 0.45 * pulse01(tMs, 700);
    },
    dispose() { mesh.geometry.dispose(); mat.dispose(); },
  };
}
// pixel direction the arrow points (y down): from the left = pointing right
const ARROW_DIRS = Object.freeze({ left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] });
// the arrow over the menu's button / knob: rect = {x, y, w, h} and from = 'left' | 'right' | 'top' | 'bottom' on a W x H px board that is widthM wide. A child of the board's mesh (z = in front).
export function createBoardArrow(THREE, parent) {
  const arrow = arrowMesh(THREE, { color: GOLD, coneR: 0.016, coneH: 0.04, shaftR: 0.0065, shaftL: 0.045, order: 1001 });
  arrow.visible = false; parent.add(arrow);
  return {
    mesh: arrow,
    update(tMs, o) {
      if (!o || !o.rect) { arrow.visible = false; return; }
      const { rect, from = 'left', W, H, widthM } = o, s = widthM / W, r = rect;
      const d = ARROW_DIRS[from] || ARROW_DIRS.left, gap = 8 + bob01(tMs, 700) * 26; // px
      let tx = r.x + r.w / 2, ty = r.y + r.h / 2;
      if (d[0] > 0) tx = r.x - gap; else if (d[0] < 0) tx = r.x + r.w + gap; else if (d[1] > 0) ty = r.y - gap; else ty = r.y + r.h + gap;
      arrow.visible = true; arrow.position.set((tx - W / 2) * s, (H / 2 - ty) * s, 0.012);
      aim(THREE, arrow, d[0], -d[1], 0);
      arrow.userData.mat.opacity = 0.6 + 0.4 * (1 - bob01(tMs, 700));
    },
    dispose() { try { parent.remove(arrow); } catch { /* */ } arrow.userData.dispose(); },
  };
}
