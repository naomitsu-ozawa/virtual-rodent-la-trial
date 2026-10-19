// VR/AR: the floating 「元に戻す」 board shown for a few seconds after a section was deleted (build 521). A small canvas board, laser-clickable (the trigger of either hand).
// THREE is passed in (no import, no DOM at module level), as with vr-ring.js createRingMenu. Hidden (mesh.visible=false) until show(); the drawing is redone only when its inputs change.
export const UNDO_BOARD_W_M = 0.13, UNDO_BOARD_H_M = 0.05;
const W = 320, H = Math.round(W * UNDO_BOARD_H_M / UNDO_BOARD_W_M), STEPS = 20; // the countdown bar moves in 20 steps (a redraw per step, not per frame)
export function createUndoButton(THREE) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(UNDO_BOARD_W_M, UNDO_BOARD_H_M), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 7; mesh.frustumCulled = false; mesh.visible = false;
  let key = '', label = '', sub = '';
  const draw = (frac, lit) => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = lit ? '#ffe27a' : '#f2b53c'; ctx.beginPath(); ctx.roundRect(2, 2, W - 4, H - 4, 26); ctx.fill();
    ctx.strokeStyle = lit ? '#fff' : 'rgba(255,255,255,.55)'; ctx.lineWidth = lit ? 7 : 3; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 50px system-ui,sans-serif'; ctx.fillText('↶ ' + label, W / 2, sub ? H * 0.40 : H * 0.46);
    if (sub) { ctx.font = '26px system-ui,sans-serif'; ctx.fillText(sub, W / 2, H * 0.70); }
    const bw = W - 64; ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(32, H - 20, bw, 8); ctx.fillStyle = '#111'; ctx.fillRect(32, H - 20, bw * Math.max(0, Math.min(1, frac)), 8);
    tex.needsUpdate = true;
  };
  return {
    mesh,
    // text: the button name; subText: e.g. the section number; both are set at show(). pos: world position; head: where the board looks.
    show(pos, head, text, subText = '') {
      label = text; sub = subText; key = '';
      mesh.position.set(pos.x, pos.y, pos.z); mesh.lookAt(head.x, head.y, head.z); mesh.updateMatrixWorld(true);
      mesh.visible = true; this.update(1, false);
    },
    hide() { mesh.visible = false; key = ''; },
    // frac: time left 0..1; lit: a laser is on the board
    update(frac, lit) { const k = Math.round(Math.max(0, Math.min(1, frac)) * STEPS) + (lit ? 'L' : '') + '|' + label + '|' + sub; if (k === key) return; key = k; draw(Math.round(Math.max(0, Math.min(1, frac)) * STEPS) / STEPS, lit); },
    // the laser of controller (raycaster already set) on the board: {distance} or null
    hit(raycaster) { if (!mesh.visible) return null; const x = raycaster.intersectObject(mesh, false)[0]; return x ? { distance: x.distance } : null; },
    dispose() { tex.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); mesh.removeFromParent(); },
  };
}
