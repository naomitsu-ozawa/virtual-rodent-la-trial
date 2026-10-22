export const VOLUME_FWD = 0.65, VOLUME_DOWN = 0.12;
export const BOARD_DIST = 0.9, BOARD_YAW_DEG = 60;
export const aside = (deg, down, d = BOARD_DIST) => ({ fwd: +(d * Math.cos(deg * Math.PI / 180)).toFixed(4), left: +(d * Math.sin(deg * Math.PI / 180)).toFixed(4), down });
export const MENU_OFFSET = aside(BOARD_YAW_DEG, 0.2);
export const HELP_OFFSET = aside(-BOARD_YAW_DEG, 0.22);
// the angle (head yaw, from the board's own direction) and the distance beyond which a board in 追従 (follow) mode glides back to its place: larger than the boards'
// 60 deg, so turning the head to read a board (or the one on the other side) does not send it away (was 0.6 rad = 34 deg and a 0.45 m chord, which a 60 deg turn exceeds)
export const FOLLOW_ANGLE = 75 * Math.PI / 180, FOLLOW_DIST = 0.45;
// the HU line's live panel (vr-hu-line.js): upper right of the volume, above eye level, so it covers neither the volume (top about
// 3 cm above the eyes at most) nor the line being drawn nor the help board; placed once, then fixed (grip moves it, 正面に戻す puts it back)
// centred above the volume (left 0), so its right edge
// (0.15 m right, about 11°) stays clear of the histogram board's left edge (about 16°); at -0.15 the two overlapped by about 8 cm
export const HU_PANEL_OFFSET = { fwd: 0.80, left: 0, down: -0.16 };
export const MENU_WIDTH = 0.5, HELP_WIDTH = 0.45, HELP_RES = 1.4;
// the HU histogram board sits above the help board (front-right, mirrored from the menu) and is 0.46 m wide.
export const HIST_OFFSET = { fwd: 0.78, left: -0.45, down: -0.1 };
export const HIST_WIDTH = 0.46;
// the 体験会 mission board (own board, no longer part of the help board): upper LEFT, above the menu (the menu's top edge is about 9 cm above eye level) and clear
// of the volume (centre, low), the HU live panel (centre, 16 cm above eye level, 0.15 m either side) and the help board (right, below eye level) / histogram board (right, above).
// 0.45 m left + 0.25 m up at 0.78 m ahead = about 30 deg to the left and 18 deg up; same width as the help board so the text keeps its size; placed once, grip moves it, 正面に戻す puts it back.
// with the menu, 60 deg to the left (0.9 m), 0.25 m up: its bottom edge (0.45 m wide, 16:9 slide: 0.25 m high) is 3.5 cm above the menu's top edge
export const EV_OFFSET = aside(BOARD_YAW_DEG, -0.25);
export const EV_WIDTH = HELP_WIDTH, EV_RES = HELP_RES;
export const boardDistance = o => Math.hypot(o.fwd, o.left, o.down);
// head: {x,y,z}; fwd / left: unit horizontal vectors {x,z}
export const placeFromHead = (head, fwd, left, o) => ({ x: head.x + fwd.x * o.fwd + left.x * o.left, y: head.y - o.down, z: head.z + fwd.z * o.fwd + left.z * o.left });
export const volumeFromHead = (head, fwd) => ({ x: head.x + fwd.x * VOLUME_FWD, y: head.y - VOLUME_DOWN, z: head.z + fwd.z * VOLUME_FWD });
