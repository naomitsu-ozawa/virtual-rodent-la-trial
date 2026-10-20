export const VOLUME_FWD = 0.65, VOLUME_DOWN = 0.12;
export const MENU_OFFSET = { fwd: 0.78, left: 0.45, down: 0.2 };
export const HELP_OFFSET = { fwd: 0.78, left: -0.45, down: 0.2 };
// the HU line's live panel (vr-hu-line.js): upper right of the volume, above eye level, so it covers neither the volume (top about
// 3 cm above the eyes at most) nor the line being drawn nor the help board; placed once, then fixed (grip moves it, 正面に戻す puts it back)
// centred above the volume (left 0), so its right edge
// (0.15 m right, about 11°) stays clear of the histogram board's left edge (about 16°); at -0.15 the two overlapped by about 8 cm
export const HU_PANEL_OFFSET = { fwd: 0.80, left: 0, down: -0.16 };
// board widths in metres: unchanged from before (not scaled with the distance)
export const MENU_WIDTH = 0.5, HELP_WIDTH = 0.32;
// the HU histogram board sits above the help board (front-right, mirrored from the menu) and is 0.46 m wide.
export const HIST_OFFSET = { fwd: 0.78, left: -0.45, down: -0.1 };
export const HIST_WIDTH = 0.46;
export const boardDistance = o => Math.hypot(o.fwd, o.left, o.down);
// head: {x,y,z}; fwd / left: unit horizontal vectors {x,z}
export const placeFromHead = (head, fwd, left, o) => ({ x: head.x + fwd.x * o.fwd + left.x * o.left, y: head.y - o.down, z: head.z + fwd.z * o.fwd + left.z * o.left });
export const volumeFromHead = (head, fwd) => ({ x: head.x + fwd.x * VOLUME_FWD, y: head.y - VOLUME_DOWN, z: head.z + fwd.z * VOLUME_FWD });
