// the marks the tutorial puts ON the slide pictures and the かんたんメニュー (VR help board / menu). Canvas 2D only (no THREE, no DOM lookups): the board's makeMenu
// draws a {type:'draw', draw(ctx)} widget by calling it. Unit-tested with a recording context (tests/unit/tutorial-marks.test.js).
//   drawStepFrame(ctx, {x, y, w, h, phase}): the frame (and a soft glow) around the numbered row of the slide that is the step now; it blinks with the phase.
//   drawDoneMark(ctx, {cx, cy, r}): a green round ✓ over the number badge of a row already done.
//   drawPointer(ctx, {x, y, w, h, phase, from, len}): a pulsing outline around a rectangle (a menu button / the board's 次へ) and an arrow toward it.
//   drawKnobHint(ctx, {kx, cy, r, phase}): the slider knob (かんたんメニュー スライス): a pulsing ring and left / right arrows.
// Redraw budget (Quest, review of): every redraw of a board re-uploads its whole canvas (the slide picture too). The marks change at most twice a second
// (ANIM_STEP_MS = 500: two states, bright / dim) and only for ANIM_IDLE_MS after the board last changed; then they stay still (bright) and nothing is redrawn.
export const PINK = '#E8508F', GOLD = '#ffd27a', GREEN = '#2f8f5b';
export const ANIM_STEP_MS = 500, ANIM_STEPS = 2, ANIM_IDLE_MS = 20000;
// the phase (0 bright, 0.5 dim) and its key at time now for a board that last changed at since (null = unknown: animate); still after ANIM_IDLE_MS
export const animLive = (now, since = null) => since == null || now - since < ANIM_IDLE_MS;
export const animPhase = (now, since = null) => (animLive(now, since) ? (Math.floor(now / ANIM_STEP_MS) % ANIM_STEPS) / ANIM_STEPS : 0);
export const animKey = (now, since = null) => (animLive(now, since) ? String(Math.floor(now / ANIM_STEP_MS) % ANIM_STEPS) : 's');
const pulse = p => 0.5 + 0.5 * Math.cos(p * 2 * Math.PI); // 1 at the cycle start, 0 half way
function arrow(ctx, x0, y0, x1, y1, color, width = 6) {
  const a = Math.atan2(y1 - y0, x1 - x0), hl = 18;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(a) * hl * 0.6, y1 - Math.sin(a) * hl * 0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - hl * Math.cos(a - 0.45), y1 - hl * Math.sin(a - 0.45)); ctx.lineTo(x1 - hl * Math.cos(a + 0.45), y1 - hl * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); }
// the step's row: a glow + a frame in the slides' pink; dim half of the time while it blinks
export function drawStepFrame(ctx, { x, y, w, h, phase = 0 } = {}) {
  const k = pulse(phase);
  ctx.save();
  ctx.globalAlpha = 0.18 + 0.12 * k; ctx.fillStyle = PINK; rr(ctx, x, y, w, h, 10); ctx.fill();
  ctx.globalAlpha = 0.45 + 0.55 * k; ctx.strokeStyle = PINK; ctx.lineWidth = 5; rr(ctx, x, y, w, h, 10); ctx.stroke();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; rr(ctx, x - 3, y - 3, w + 6, h + 6, 12); ctx.stroke();
  ctx.restore();
}
// a row already done: a green ✓ disc over its number badge (centre cx, cy, radius r)
export function drawDoneMark(ctx, { cx, cy, r = 14 } = {}) {
  ctx.save();
  circle(ctx, cx, cy, r + 2); ctx.fillStyle = '#fff'; ctx.fill();
  circle(ctx, cx, cy, r); ctx.fillStyle = GREEN; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, r * 0.28); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(cx - r * 0.5, cy + r * 0.02); ctx.lineTo(cx - r * 0.12, cy + r * 0.4); ctx.lineTo(cx + r * 0.52, cy - r * 0.38); ctx.stroke();
  ctx.restore();
}
// a pulsing outline around {x,y,w,h} and an arrow from the side 'from' ('left' | 'right' | 'top' | 'bottom'; null = no arrow) toward it
export function drawPointer(ctx, { x, y, w, h, phase = 0, from = 'left', color = PINK, len = 70 } = {}) {
  const k = pulse(phase), b = 10 * k, grow = 4 + 8 * (1 - k);
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.65 * k; ctx.strokeStyle = color; ctx.lineWidth = 8; rr(ctx, x - grow, y - grow, w + 2 * grow, h + 2 * grow, 18); ctx.stroke(); ctx.globalAlpha = 1;
  const cx = x + w / 2, cy = y + h / 2, L = len;
  if (from === 'left') arrow(ctx, x - L - 14 - b, cy, x - 14 - b, cy, GOLD);
  else if (from === 'right') arrow(ctx, x + w + L + 14 + b, cy, x + w + 14 + b, cy, GOLD);
  else if (from === 'top') arrow(ctx, cx, y - L - 14 - b, cx, y - 14 - b, GOLD);
  else if (from === 'bottom') arrow(ctx, cx, y + h + L + 14 + b, cx, y + h + 14 + b, GOLD); // from null: the outline only
  ctx.restore();
}
// the slider knob of the かんたんメニュー (centre kx, cy, radius r): a pulsing ring around it and arrows to the left and right that move (= drag it sideways)
export function drawKnobHint(ctx, { kx, cy, r = 26, phase = 0 } = {}) {
  const k = pulse(phase), d = 10 * (1 - k);
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.65 * k; ctx.strokeStyle = PINK; ctx.lineWidth = 8; circle(ctx, kx, cy, r + 8 + 10 * (1 - k)); ctx.stroke(); ctx.globalAlpha = 1;
  arrow(ctx, kx - r - 22 - d, cy, kx - r - 64 - d, cy, GOLD, 6); arrow(ctx, kx + r + 22 + d, cy, kx + r + 64 + d, cy, GOLD, 6);
  ctx.restore();
}
