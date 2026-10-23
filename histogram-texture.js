// HU histogram helpers for the VR volume texture's CPU copy. Pure functions, no DOM, no app state (unit-tested: tests/unit/histogram-texture.test.js).
// The VR texture data (vr-view.js prepared.vd / half) is rg8-packed u16 [tw, th, td], HU = (u16 - bias) * slope + intercept.
// the VR board counts that data itself (vr-label-histogram.js: binned in its worker); the PC consumer / texture pass that used the
// rest of this file is gone (histogram-ui.js), so only what is still used stays here.
import { HIST_BINS, createHist } from './histogram.js?v=20261023-build659';

// does the texture hold the values the effective mode asks for? (filtered mode with filters on needs a filtered texture, raw needs a raw one)
export const textureMatchesMode = (tex, modeKey) => !!tex && !!tex.data && !!tex.dims && (modeKey === 'filtered') === !!tex.filtered;
export const createAcc = () => new Float64Array(HIST_BINS);
// a weighted accumulator -> a histogram (whole counts). Rounded on the running sum, so the total is the rounded weighted total (rounding each
// bin on its own would drift by up to half a count per bin) and every bin is within one count of its weighted value.
export function accToHist(acc) {
  const h = createHist();
  let cum = 0, prev = 0;
  for (let i = 0; i < HIST_BINS; i++) { cum += acc[i]; const r = Math.round(cum); h[i] = r - prev; prev = r; }
  return h;
}
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const views = new WeakMap();
// the texture's rg8 bytes (lo, hi) as u16 values: a view on the same memory (little-endian, even offset: every platform we run on), else one copy.
// Kept per data array, so a pass and the next share it.
export function textureU16(tex) {
  const d = tex.data; let u = views.get(d);
  if (u) return u;
  const n = d.length >> 1;
  if (LE && d.byteOffset % 2 === 0) u = new Uint16Array(d.buffer, d.byteOffset, n);
  else { u = new Uint16Array(n); for (let i = 0; i < n; i++) u[i] = d[2 * i] | (d[2 * i + 1] << 8); }
  views.set(d, u);
  return u;
}
