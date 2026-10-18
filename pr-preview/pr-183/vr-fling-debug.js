// VR/AR, debug mode only (build 522): a small board with the measured values of the last section release (throw to delete): verdict, frame / hand speed, direction cos,
// samples / span / time to the release (text from vr-section-frame.js flingDebugLines). Not a laser target. THREE is passed in (no import, no DOM at module level), as with
// vr-undo-button.js. Hidden (mesh.visible=false) until show(); vr-view.js creates it only while the debug mode is on and hides it after FLING_DEBUG_MS.
export const FLING_DEBUG_W_M = 0.2, FLING_DEBUG_H_M = 0.07;
const W = 640, H = Math.round(W * FLING_DEBUG_H_M / FLING_DEBUG_W_M);
export function createFlingDebugTag(THREE) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLING_DEBUG_W_M, FLING_DEBUG_H_M), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 7; mesh.frustumCulled = false; mesh.visible = false;
  let until = 0;
  return {
    mesh,
    // lines: text lines (the first is the verdict); ok: green (deleted) or amber (kept); pos: world position; head: where the board looks; now / ms: shown until now + ms
    show(lines, ok, pos, head, now, ms) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(14,20,27,.85)'; ctx.beginPath(); ctx.roundRect(2, 2, W - 4, H - 4, 18); ctx.fill();
      ctx.strokeStyle = ok ? '#5fd38a' : '#f2b53c'; ctx.lineWidth = 5; ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const lh = (H - 24) / Math.max(1, lines.length);
      lines.forEach((ln, i) => { ctx.fillStyle = i ? '#e8f1f8' : ok ? '#8ff0b0' : '#ffd27a'; ctx.font = (i ? '' : 'bold ') + '30px system-ui,sans-serif'; ctx.fillText(ln, 22, 12 + lh * (i + 0.5)); });
      tex.needsUpdate = true;
      mesh.position.set(pos.x, pos.y, pos.z); mesh.lookAt(head.x, head.y, head.z); mesh.updateMatrixWorld(true);
      mesh.userData.text = lines.join('\n'); mesh.visible = true; until = now + ms;
    },
    update(now) { if (mesh.visible && now >= until) mesh.visible = false; },
    hide() { mesh.visible = false; },
    dispose() { tex.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); mesh.removeFromParent(); },
  };
}
