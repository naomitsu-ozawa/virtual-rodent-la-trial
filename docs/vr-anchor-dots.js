import { GHOST_ALPHA } from './vr-depth.js?v=20261112-build724';

export const ANCHOR_DOT_DIAMETER_M = 0.005; // world metres: fixed, the model's scale does not change it
const CAPACITY0 = 32;

// A card is a billboard that writes no depth, so the depth test cannot hide a dot behind it: it is judged here. Card-local coordinates (x right, y up, +z toward the viewer; the card is the
// rectangle |x| <= hw, |y| <= hh in z = 0); eye = the viewer's eye, p = the dot's centre, r = the dot's radius (same units). True when the dot lies behind the card's plane and the line
// from the eye to the dot crosses the card (its rectangle grown by r): the dot is not drawn at all (not even translucent).
export function dotBehindCard(eye, p, hw, hh, r = 0) {
  if (!(eye.z > 0) || !(p.z < 0)) return false;
  const t = eye.z / (eye.z - p.z), x = eye.x + t * (p.x - eye.x), y = eye.y + t * (p.y - eye.y);
  return Math.abs(x) <= hw + r && Math.abs(y) <= hh + r;
}

// dots: [{hidden, covered}] (hidden: the anchor is behind tissue, from the CPU judgement; only read when gpu is false; covered: behind a card = in neither pass). -> { body: [index], ghost: [index] } (the dots each pass draws)
export function dotSets(dots, gpu) {
  const body = [], ghost = [];
  dots.forEach((d, i) => {
    if (d.covered) return;
    if (gpu) { body.push(i); ghost.push(i); } else if (d.hidden) ghost.push(i); else body.push(i);
  });
  return { body, ghost };
}

export function createAnchorDots(THREE, scene) {
  const geo = new THREE.SphereGeometry(ANCHOR_DOT_DIAMETER_M / 2, 10, 8);
  const mat = o => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, ...o }); // the colour of each dot is the instance colour (white x instance colour)
  const bodyMat = mat({ depthTest: true }), ghostMat = mat({ depthTest: true, depthFunc: THREE.GreaterDepth, opacity: GHOST_ALPHA });
  let cap = 0, body = null, ghost = null, lastKey = '';
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const make = n => {
    for (const o of [body, ghost]) if (o) { scene.remove(o); o.dispose(); }
    cap = n;
    body = new THREE.InstancedMesh(geo, bodyMat, cap); ghost = new THREE.InstancedMesh(geo, ghostMat, cap);
    for (const o of [body, ghost]) { o.renderOrder = 5; o.frustumCulled = false; o.count = 0; o.visible = false; scene.add(o); }
    lastKey = '';
  };
  const fill = (mesh, dots, idx) => {
    mesh.count = idx.length; mesh.visible = idx.length > 0;
    idx.forEach((k, j) => { const d = dots[k]; m4.makeTranslation(d.x, d.y, d.z); mesh.setMatrixAt(j, m4); mesh.setColorAt(j, col.set(d.color)); });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  return {
    // every frame: dots = [{x,y,z (world), color (number / css string), hidden}]; gpu = GPU occlusion is active. Nothing is uploaded when nothing moved.
    update(dots, gpu) {
      if (!dots.length) { if (body && (body.visible || ghost.visible)) { body.visible = ghost.visible = false; body.count = ghost.count = 0; lastKey = ''; } return; }
      if (dots.length > cap) make(Math.max(CAPACITY0, cap * 2, dots.length));
      const sets = dotSets(dots, gpu);
      let key = (gpu ? 'g' : 'f') + '|' + sets.body.join(',') + '|' + sets.ghost.join(',');
      for (const d of dots) key += '|' + d.x.toFixed(5) + ',' + d.y.toFixed(5) + ',' + d.z.toFixed(5) + ',' + d.color;
      if (key === lastKey) return;
      lastKey = key;
      bodyMat.depthTest = gpu; ghostMat.depthTest = gpu; // 「薄くする」: both on top, the hidden dots are the faint ones
      fill(body, dots, sets.body); fill(ghost, dots, sets.ghost);
    },
    get bodyMesh() { return body; }, get ghostMesh() { return ghost; },
    dispose() { for (const o of [body, ghost]) if (o) { scene.remove(o); o.dispose(); } geo.dispose(); bodyMat.dispose(); ghostMat.dispose(); body = ghost = null; },
  };
}

export const LEG_WIDTH_M = 0.0024, LEG_MIN_ANGLE = 0.0025;
export function createLegMesh(THREE) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(12, 3));
  g.setAttribute('other', new THREE.Float32BufferAttribute(12, 3));
  g.setAttribute('aux', new THREE.Float32BufferAttribute([-1, 1, -1, -1, 1, 1, 1, -1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xffffff) }, opacity: { value: 1 }, width: { value: LEG_WIDTH_M }, minAngle: { value: LEG_MIN_ANGLE } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: 'attribute vec3 other;attribute vec2 aux;uniform float width,minAngle;varying float vS;void main(){vec3 d=(other-position)*aux.y;float L=length(d);d=L>1e-7?d/L:vec3(0.,1.,0.);vec3 s=cross(d,cameraPosition-position);float sl=length(s);s=sl>1e-9?s/sl:vec3(1.,0.,0.);float w=max(width,length(cameraPosition-position)*minAngle);vS=aux.x;gl_Position=projectionMatrix*viewMatrix*vec4(position+s*aux.x*w*0.5,1.);}',
    fragmentShader: 'uniform vec3 color;uniform float opacity;varying float vS;void main(){float a=(1.-smoothstep(0.6,1.,abs(vS)))*opacity;gl_FragColor=vec4(color,a);\n#include <colorspace_fragment>\n}',
  });
  m.color = m.uniforms.color.value;
  Object.defineProperty(m, 'opacity', { get() { return m.uniforms.opacity.value; }, set(v) { m.uniforms.opacity.value = v; }, configurable: true });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.raycast = () => {};
  return mesh;
}
