// the event deck's slides on the VR boards, AS THEY ARE: each slide is a picture (docs/tutorial/slides/<id>.webp, 1280 x 720, rendered from the deck's own HTML,
// fonts and images at 1920 x 1080 and scaled down). Nothing of the slide body is redrawn as text; the boards add only their title row, their buttons and, on a tutorial step,
// the frame around the step's numbered row and the ✓ of the rows done (tutorial-vr.js). Pure constants + a small image cache (the element factory is injected).
// Unit-tested in tests/unit/tutorial-slides.test.js.
//   GUIDE_SLIDES: the 詳細 tab of the help board shows them read-only, in this order (controls, g1, g2, g3, g3b, g4); the tutorial steps are built on controls..g3b (g4 is view only).
//   LEVEL_SLIDES: the 体験会 mission board (vr-view.js ev board) shows the chosen level's slide (event mode only).
// items: the numbered rows of the slide (the round number badge + its texts), measured on the rendered slide in slide pixels (SLIDE_W x SLIDE_H): {n, x, y, w, h}.
export const SLIDE_W = 1920, SLIDE_H = 1080;
const SLIDE_QUERY = '?v=20261023-build661'; // same cache-busting form as the other assets (tools/bump-build.mjs rewrites it)
export const SLIDE_BASE = './tutorial/slides/';
export const slideSrc = (id, base = SLIDE_BASE) => (id ? `${base}${id}.webp${SLIDE_QUERY}` : null);
const t = (ja, en) => Object.freeze({ ja, en });
const row = (n, x, y, w, h) => Object.freeze({ n, x, y, w, h });
export const GUIDE_SLIDES = deepFreeze([
  { id: 'controls', title: t('コントローラーの使い方', 'Using the controllers'), items: [] },
  { id: 'g1', title: t('グリップでつかんで動かす', 'Grab and move with the grip'),
    items: [row(1, 1228, 260, 580, 90), row(2, 1228, 378, 580, 90), row(3, 1228, 496, 580, 90)] },
  { id: 'g2', title: t('断面を出して動かす', 'Show a section and move it'),
    items: [row(1, 1228, 260, 580, 90), row(2, 1228, 378, 580, 139), row(3, 1228, 545, 580, 90)] },
  { id: 'g3', title: t('メニューを使う', 'Using the menu'),
    items: [row(1, 1228, 260, 580, 121), row(2, 1228, 409, 580, 121), row(3, 1228, 558, 580, 155), row(4, 1228, 741, 580, 87)] },
  { id: 'g3b', title: t('スライスの透け具合を変える', 'Changing how clear the slice is'),
    items: [row(1, 1228, 260, 580, 121), row(2, 1228, 409, 580, 121), row(3, 1228, 558, 580, 121)] },
  { id: 'g4', title: t('ラベルを出す・距離を測る', 'Labels and distances'),
    items: [row(1, 1228, 261, 580, 124), row(2, 1228, 413, 580, 90), row(3, 1228, 531, 580, 90)] },
]);
export const LEVEL_SLIDES = deepFreeze([
  { id: 'lv0', lv: 0, title: t('骨の中のスポンジ構造を観察しよう', 'Look at the sponge-like structure inside the bone') },
  { id: 'lv1', lv: 1, title: t('篩骨迷路と肺の構造を観察しよう', 'Look at the ethmoid labyrinth and the lungs') },
  { id: 'lv2', lv: 2, title: t('おなかの脂肪を観察しよう', 'Look at the fat in the belly') },
  { id: 'lv3', lv: 3, title: t('腎臓を探して長さを測ろう', 'Find a kidney and measure its length') },
]);
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
export const guideSlide = id => GUIDE_SLIDES.find(s => s.id === id) || null;
export const levelSlide = id => LEVEL_SLIDES.find(s => s.id === id) || null;
export const slideItem = (id, n) => guideSlide(id)?.items.find(r => r.n === n) || null;
// a {ja, en} pair in the board's language
export const loc = (p, lang) => (p ? (lang === 'en' ? p.en || p.ja : p.ja) : '');
// a slide row (slide pixels) on a picture drawn at {x, y, w, h} of a board, widened by pad slide pixels
export function itemRect(r, at, pad = 10) {
  const kx = at.w / SLIDE_W, ky = at.h / SLIDE_H;
  return { x: at.x + (r.x - pad) * kx, y: at.y + (r.y - pad) * ky, w: (r.w + 2 * pad) * kx, h: (r.h + 2 * pad) * ky };
}
// the pictures, loaded on first use: get(id) = the element once it has loaded (else null, and the load starts); onLoad(id) is called once per picture when it arrives (the board
// redraws then). A picture that fails stays null (the board shows its place empty). make() = the element factory (new Image() in the page; a fake in the tests).
export function createSlideImages({ onLoad = () => {}, make = () => (typeof Image === 'function' ? new Image() : null), base = SLIDE_BASE } = {}) {
  const map = new Map();
  return {
    get(id) {
      if (!id) return null;
      let e = map.get(id);
      if (!e) {
        e = { img: null, ok: false };
        map.set(id, e);
        try {
          const img = make(); if (!img) return null;
          e.img = img; img.decoding = 'async';
          img.onload = () => { e.ok = true; try { onLoad(id); } catch { /* */ } };
          img.onerror = () => { e.ok = false; };
          img.src = slideSrc(id, base);
        } catch { e.img = null; }
      }
      return e.ok ? e.img : null;
    },
    loaded: id => !!map.get(id)?.ok,
  };
}
