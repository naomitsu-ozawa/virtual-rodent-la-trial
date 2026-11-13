
export const SLOTS_MAX = 16;

// three's sort key of an object at (x, y, z) in the world: its projected depth z / w (V = the camera's matrixWorldInverse, P = its projection), the larger (the farther) first in three; ours is minus that, the smaller first
export const keyOf = (V, P, x, y, z) => { const vx = V[0] * x + V[4] * y + V[8] * z + V[12], vy = V[1] * x + V[5] * y + V[9] * z + V[13], vz = V[2] * x + V[6] * y + V[10] * z + V[14]; return -(P[2] * vx + P[6] * vy + P[10] * vz + P[14]) / (P[3] * vx + P[7] * vy + P[11] * vz + P[15]); };

// the order of the items (cards and legs): renderOrder, then the farther first, then the older first
export const itemLess = (a, b) => (a.ro - b.ro) || (a.z !== b.z ? a.z - b.z : a.id - b.id);

// items sorted by itemLess ({ro, dt, tex (a card's texture; null for a leg)}) -> runs [{ro, dt, from, to (exclusive), texs: [distinct textures of the cards, in order of first use]}]:
// a run ends where renderOrder / depthTest change or a card's texture would be the (slots+1)th
export function planRuns(items, slots) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i], t = it.tex;
    if (cur && cur.ro === it.ro && cur.dt === it.dt && (t == null || cur.texs.includes(t) || cur.texs.length < slots)) {
      cur.to = i + 1; if (t != null && !cur.texs.includes(t)) cur.texs.push(t);
    } else { cur = { ro: it.ro, dt: it.dt, from: i, to: i + 1, texs: t == null ? [] : [t] }; runs.push(cur); }
  }
  return runs;
}

const VS = 'attribute vec2 aux;attribute vec3 iA,iB,iOA,iOB,iCol;attribute float iKind,iTex,iAlpha;uniform float width,minAngle;uniform vec2 cardSize;varying vec2 vUv;varying float vTex,vA,vK,vS;varying vec3 vC;'
  + 'void main(){vK=iKind;vA=iAlpha;vTex=iTex;vUv=aux*0.5+0.5;vS=0.;vC=vec3(0.);'
  + 'if(iKind<0.5){gl_Position=projectionMatrix*viewMatrix*instanceMatrix*vec4(aux*cardSize*0.5,0.,1.);}'
  + 'else{bool a=aux.y>0.;vec3 p=a?iA:iB;vec3 o=a?iOA:iOB;vec3 d=(o-p)*aux.y;float L=length(d);d=L>1e-7?d/L:vec3(0.,1.,0.);vec3 s=cross(d,cameraPosition-p);float sl=length(s);s=sl>1e-9?s/sl:vec3(1.,0.,0.);float w=max(width,length(cameraPosition-p)*minAngle);vS=aux.x;vC=iCol;vUv=vec2(0.);gl_Position=projectionMatrix*viewMatrix*vec4(p+s*aux.x*w*0.5,1.);}}';
const fs = slots => {
  let pick = '';
  for (let i = 0; i < slots; i++) pick += (i ? 'else ' : '') + (i < slots - 1 ? 'if(i==' + i + ')' : '') + 'c=textureGrad(t' + i + ',vUv,dx,dy);';
  return 'uniform sampler2D ' + Array.from({ length: slots }, (_, i) => 't' + i).join(',') + ';varying vec2 vUv;varying float vTex,vA,vK,vS;varying vec3 vC;'
    + 'void main(){vec2 dx=dFdx(vUv),dy=dFdy(vUv);if(vK<0.5){int i=int(vTex+0.5);vec4 c;' + pick + 'gl_FragColor=vec4(c.rgb,c.a*vA);}'
    + 'else{float a=(1.-smoothstep(0.6,1.,abs(vS)))*vA;gl_FragColor=vec4(vC,a);}\n#include <colorspace_fragment>\n}';
};

// THREE, scene; w, h = the card plane (LABEL_W x LABEL_H); legWidth / legMinAngle = vr-anchor-dots.js LEG_WIDTH_M / LEG_MIN_ANGLE
export function createLabelBatch(THREE, scene, { w, h, legWidth, legMinAngle }) {
  const regs = new Set(); // every label (lb: {m, line}) in creation order
  let slots = 0, dummy = null, lastSlots = 0;
  const pool = []; // the drawn runs (reused frame to frame)
  const stats = { draws: 0, cards: 0, legs: 0 };
  const sortItems = [], itemPool = [];

  const makeRun = cap => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(12, 3));
    g.setAttribute('aux', new THREE.Float32BufferAttribute([-1, 1, -1, -1, 1, 1, 1, -1], 2)); // the corners: (side, end) of a leg's ribbon = (x, y) of the card's plane (y = +1 the top)
    g.setIndex([0, 1, 2, 1, 3, 2]);
    const att = n => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
    const A = att(3), B = att(3), OA = att(3), OB = att(3), C = att(3), AL = att(1), K = att(1), T = att(1);
    g.setAttribute('iA', A); g.setAttribute('iB', B); g.setAttribute('iOA', OA); g.setAttribute('iOB', OB); g.setAttribute('iCol', C); g.setAttribute('iAlpha', AL); g.setAttribute('iKind', K); g.setAttribute('iTex', T);
    const uniforms = { width: { value: legWidth }, minAngle: { value: legMinAngle }, cardSize: { value: new THREE.Vector2(w, h) } };
    for (let i = 0; i < slots; i++) uniforms['t' + i] = { value: dummy };
    const mat = new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, vertexShader: VS, fragmentShader: fs(slots) });
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.count = 0; mesh.visible = false; scene.add(mesh);
    return { cap, g, mat, mesh, A, B, OA, OB, C, AL, K, T, uniforms };
  };
  let dummyUp = false; // the filler has been bound by a drawn run since it was last released
  const freeDummy = () => { if (dummyUp && dummy) dummy.dispose(); dummyUp = false; };
  const killRun = r => { scene.remove(r.mesh); r.mesh.dispose(); r.g.dispose(); r.mat.dispose(); };

  return {
    add(lb) { regs.add(lb); },
    remove(lb) { regs.delete(lb); if (!regs.size) freeDummy(); }, // the last card gone (the partner let go): the filler is not held on the GPU for nothing (three uploads it again when a run next draws)
    get size() { return regs.size; },
    stats,
    // once a frame, after every card and leg of the frame is placed and before renderer.render(scene, camera)
    flush(renderer, camera) {
      if (!slots) {
        slots = Math.max(1, Math.min(SLOTS_MAX, renderer.capabilities.maxTextures | 0 || 8));
        dummy = new THREE.DataTexture(new Uint8Array(4), 1, 1); dummy.needsUpdate = true;
      }
      if (slots !== lastSlots) { for (const r of pool) killRun(r); pool.length = 0; lastSlots = slots; }
      const cam = renderer.xr && renderer.xr.isPresenting ? renderer.xr.getCamera() : camera, V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
      const items = sortItems; let n = 0, nCards = 0, nLegs = 0; // the item objects are reused (no garbage per frame)
      for (const lb of regs) {
        const m = lb.m, ln = lb.line;
        if (m.visible) {
          m.updateWorldMatrix(true, false);
          const e = m.matrixWorld.elements, it = itemPool[n] || (itemPool[n] = { lb: null, ro: 0, dt: true, tex: null, id: 0, z: 0 });
          it.lb = lb; it.ro = m.renderOrder; it.dt = !!m.material.depthTest; it.tex = m.material.map || dummy; it.id = m.id; it.z = keyOf(V, P, e[12], e[13], e[14]); items[n++] = it; nCards++;
        }
        if (ln.visible) {
          const p = ln.geometry.attributes.position.array, it = itemPool[n] || (itemPool[n] = { lb: null, ro: 0, dt: true, tex: null, id: 0, z: 0 });
          it.lb = lb; it.ro = ln.renderOrder; it.dt = !!ln.material.depthTest; it.tex = null; it.id = m.id + 0.5; it.z = keyOf(V, P, (p[0] + p[3]) * 0.5, (p[1] + p[4]) * 0.5, (p[2] + p[5]) * 0.5); items[n++] = it; nLegs++;
        }
      }
      items.length = n;
      items.sort(itemLess);
      const plan = planRuns(items, slots);
      plan.forEach((p, k) => {
        const cnt = p.to - p.from;
        let r = pool[k];
        if (!r || r.cap < cnt) { if (r) killRun(r); r = pool[k] = makeRun(Math.max(64, cnt, r ? r.cap * 2 : 0)); }
        r.mat.depthTest = p.dt;
        r.mesh.renderOrder = p.ro - 0.01 + 0.0001 * k;
        for (let i = 0; i < slots; i++) r.uniforms['t' + i].value = p.texs[i] || dummy;
        const M = r.mesh.instanceMatrix.array;
        for (let i = 0; i < cnt; i++) {
          const it = items[p.from + i], lb = it.lb;
          if (it.tex) { // a card
            M.set(lb.m.matrixWorld.elements, 16 * i); r.K.array[i] = 0; r.T.array[i] = p.texs.indexOf(it.tex); r.AL.array[i] = lb.m.material.opacity;
          } else { // a leg: both ends and the `other` of each end as setLeaderIfMoved wrote them (the partner's legs never get `other`: kept as it was)
            const ln = lb.line, P4 = ln.geometry.attributes.position.array, O = ln.geometry.attributes.other.array, c = ln.material.color, j = 3 * i;
            r.A.array[j] = P4[0]; r.A.array[j + 1] = P4[1]; r.A.array[j + 2] = P4[2]; r.B.array[j] = P4[3]; r.B.array[j + 1] = P4[4]; r.B.array[j + 2] = P4[5];
            r.OA.array[j] = O[0]; r.OA.array[j + 1] = O[1]; r.OA.array[j + 2] = O[2]; r.OB.array[j] = O[3]; r.OB.array[j + 1] = O[4]; r.OB.array[j + 2] = O[5];
            r.C.array[j] = c.r; r.C.array[j + 1] = c.g; r.C.array[j + 2] = c.b; r.K.array[i] = 1; r.AL.array[i] = ln.material.opacity;
          }
        }
        r.mesh.count = cnt; r.mesh.visible = true;
        r.mesh.instanceMatrix.needsUpdate = true; for (const a of [r.A, r.B, r.OA, r.OB, r.C, r.AL, r.K, r.T]) a.needsUpdate = true;
      });
      for (let k = plan.length; k < pool.length; k++) { pool[k].mesh.visible = false; pool[k].mesh.count = 0; }
      if (plan.length) dummyUp = true; else freeDummy();
      stats.draws = plan.length; stats.cards = nCards; stats.legs = nLegs;
    },
    dispose() { for (const r of pool) killRun(r); pool.length = 0; regs.clear(); dummy?.dispose(); dummy = null; slots = 0; },
  };
}
