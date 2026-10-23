// Default placement of the VR/AR volume and boards.
// Offsets are metres in the head's horizontal frame: fwd = ahead of the head
// (level), left = to the head's left (negative = right), down = below eye level.
// Quest 3 reads UI comfortably at about 0.75-1.5 m, so the boards sit at about
// 0.9 m (were 0.71 / 0.72 m). Their physical size and canvas are unchanged (by
// request), so they simply look a little smaller. The volume is at 0.65 m
// (was 0.55 m) and the boards are kept beside it, not in front of it.
export const VOLUME_FWD = 0.65, VOLUME_DOWN = 0.12;
// the menu (left) and the help board (right) sit farther out to the sides: seen only when the head turns, yet with the head straight their inner
// edges just peek in at the edge of the view (Quest 3: about 110 deg across, 55 deg each side). Both centres 50 deg out at 0.9 m (horizontal; was 60 deg: too wide); the boards face the
// head, so the inner edge is 50 - atan(half width / 0.9): menu (0.5 m) 34.5 deg, help (0.45 m) 36 deg (inside the view's 55 deg edge by about 19-20 deg: a board is in view from the side of the eye, not just peeking).
// (were 0.78 ahead / 0.45 aside = 30 deg, inner edges at 14.5 / 20 deg.) The help board is 2 cm lower than the menu so its top stays under the histogram board.
export const BOARD_DIST = 0.9, BOARD_YAW_DEG = 50; // 50 deg (was 60: too wide a turn); inner edges 60 -> 50: menu (0.5 m) 34.5 deg, help (0.45 m) 36 deg
export const aside = (deg, down, d = BOARD_DIST) => ({ fwd: +(d * Math.cos(deg * Math.PI / 180)).toFixed(4), left: +(d * Math.sin(deg * Math.PI / 180)).toFixed(4), down });
export const MENU_OFFSET = aside(BOARD_YAW_DEG, 0.2);
export const HELP_OFFSET = aside(-BOARD_YAW_DEG, 0.254); // 0.22 -> 0.254: the board is 7 cm taller now (the caption under the slide), its top edge stays where it was
// the angle (head yaw, from the board's own direction) and the distance beyond which a board in 追従 (follow) mode glides back to its place: larger than the boards'
// the boards' 50 deg (65 deg = 50 + 15), so turning the head to read a board (or the one on the other side) does not send it away (was 0.6 rad = 34 deg and a 0.45 m chord, which a 50 deg turn exceeds)
export const FOLLOW_ANGLE = 65 * Math.PI / 180, FOLLOW_DIST = 0.45;
// the HU line's live panel (vr-hu-line.js): upper right of the volume, above eye level, so it covers neither the volume (top about
// 3 cm above the eyes at most) nor the line being drawn nor the help board; placed once, then fixed (grip moves it, 正面に戻す puts it back)
// centred above the volume (left 0), so its right edge
// (0.15 m right, about 11°) stays clear of the histogram board's left edge (about 16°); at -0.15 the two overlapped by about 8 cm
export const HU_PANEL_OFFSET = { fwd: 0.80, left: 0, down: -0.16 };
// board widths in metres.: the help board 1.4 times larger (0.32 -> 0.45 m; the slide pictures were too small to read). Its canvas keeps its 820 px
// layout and is drawn at HELP_RES times the pixels (makeMenu res), so the texels per metre stay as before (2560 / m): 1148 x 885 px, about 4 MB (+ mipmaps).
export const MENU_WIDTH = 0.5, HELP_WIDTH = 0.45, HELP_RES = 1.4;
// the HU histogram board sits above the help board (front-right, mirrored from the menu) and is 0.46 m wide.
export const HIST_OFFSET = { fwd: 0.78, left: -0.45, down: -0.1 };
export const HIST_WIDTH = 0.46;
// the 体験会 mission board (own board, no longer part of the help board): upper LEFT, above the menu (the menu's top edge is about 9 cm above eye level) and clear
// of the volume (centre, low), the HU live panel (centre, 16 cm above eye level, 0.15 m either side) and the help board (right, below eye level) / histogram board (right, above).
// 0.45 m left + 0.25 m up at 0.78 m ahead = about 30 deg to the left and 18 deg up; same width as the help board so the text keeps its size; placed once, grip moves it, 正面に戻す puts it back.
// with the menu, 50 deg to the left (0.9 m), 0.25 m up: its bottom edge (0.45 m wide, 16:9 slide: 0.25 m high) is 3.5 cm above the menu's top edge
// the mission board of Lv1-Lv3 sits straight ahead, BEHIND the volume (1.1 m; the volume is at 0.65 m and at most 0.30 m across) and a little above the
// line of sight: its bottom edge is 6 deg above the eyes (the volume / its section frame reach about 5 deg at most), its top 27 deg. 0.8 m wide (the help board is 0.45 m): 40 deg across at that distance
// (the help board 28 deg), its canvas 1280 px = the slide picture's own width. The boards at the sides (menu left, help right, 50 deg out) are untouched. It follows the head like the help board
// (settings.help: 1 = lazily, 2 = fixed); grip moves it, 正面に戻す puts it back.
// on the right, straight above the help board (the same 50 deg), at 1.1 m so it keeps its size in the view (40 deg across).
// The help board's top edge is 4.7 cm below the eyes (0.254 - its 0.414 m / 2): 3 deg down at 0.9 m; the mission board's lower edge is 1.9 cm above the eyes (1 deg up at 1.1 m),
// its top 23 deg up. Centre 0.244 m above the eyes (0.019 + its 0.45 m / 2). The volume (centre, at most 15 deg out) and the menu (left) are clear of it.
export const EV_DIST = 1.1;
export const EV_OFFSET = aside(-BOARD_YAW_DEG, -0.244, EV_DIST);
export const EV_WIDTH = 0.8, EV_RES = 1280 / 820;
export const boardDistance = o => Math.hypot(o.fwd, o.left, o.down);
// head: {x,y,z}; fwd / left: unit horizontal vectors {x,z}
export const placeFromHead = (head, fwd, left, o) => ({ x: head.x + fwd.x * o.fwd + left.x * o.left, y: head.y - o.down, z: head.z + fwd.z * o.fwd + left.z * o.left });
export const volumeFromHead = (head, fwd) => ({ x: head.x + fwd.x * VOLUME_FWD, y: head.y - VOLUME_DOWN, z: head.z + fwd.z * VOLUME_FWD });
