// CPU pick for the WebGL page volume (webgl-volume.js): a port of volumePickShader (medical-volume.js, the WebGPU compute pick) to JS. The first voxel of a shown segment along a ray, in
// the volume's object space, with the nearest-voxel samples the WebGPU pick takes (the segment test is the HU range of the segment and the edit / processing mask, like
// segMember there). Pure: no DOM, no GL, no three.js (unit-tested: tests/unit/webgl-volume.test.js).
//
//   data      rg8-packed u16 volume (Uint8Array, little endian), grid `dims` = [tw, th, td]; HU = (u16 - bias) * slope + intercept
//   edit      null | {activeMask, maskOnly, data (RGBA8, channel = segment slot, >= 128 = allowed), dims}: the processing mask of buildEditMaskOf (vr-volume-prep.js)
//   segs      [{min, max, enabled}] of the four slots
//   preferred slot index to look for only (-1: any)
//   srcDims   the volume's own grid (the voxel that is returned lives there)
//   hidden    null | (slot, tc) -> true where a HIDDEN shape (a hidden result: region.hidden, a hidden child segment: visible false) covers the slot: the first segment there is then no hit and the
//             ray goes on, as the drawing does (vr-view.js passH: the shader takes the first slot, then skips it when hidden). hiddenTestOf builds it from the index grids and their tables.
// Returns {x, y, z, slot} (x / y / z in srcDims) or null.

const clamp01 = v => (v < 0 ? 0 : v > 0.999999 ? 0.999999 : v);

export function hitBox(o, d, h) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i], a = (-h[i] - o[i]) * inv, b = (h[i] - o[i]) * inv;
    lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
  }
  return [lo, hi];
}

// object space -> texture coordinates (y runs down the rows)
export const texCoordOf = (p, h) => [p[0] / (2 * h[0]) + 0.5, 0.5 - p[1] / (2 * h[1]), p[2] / (2 * h[2]) + 0.5];

export function pickRay({ data, dims, calibration, halfExt, step, origin, dir, segs, edit = null, preferred = -1, srcDims = dims, hidden = null }) {
  const [tw, th, td] = dims, slope = calibration[0], intercept = calibration[1], bias = calibration[2];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1, d = [dir[0] / len, dir[1] / len, dir[2] / len];
  const [t0, endT] = hitBox(origin, d, halfExt);
  if (!(t0 <= endT)) return null;
  const st = Math.max(step, 1e-5);
  const huAt = tc => {
    const x = Math.min(Math.floor(clamp01(tc[0]) * tw), tw - 1), y = Math.min(Math.floor(clamp01(tc[1]) * th), th - 1), z = Math.min(Math.floor(clamp01(tc[2]) * td), td - 1);
    const o = ((z * th + y) * tw + x) * 2;
    return ((data[o] | (data[o + 1] << 8)) - bias) * slope + intercept;
  };
  const allows = (s, tc) => {
    if (!edit || !((edit.activeMask >> s) & 1)) return true;
    const [ew, eh, ed] = edit.dims, x = Math.min(Math.floor(clamp01(tc[0]) * ew), ew - 1), y = Math.min(Math.floor(clamp01(tc[1]) * eh), eh - 1), z = Math.min(Math.floor(clamp01(tc[2]) * ed), ed - 1);
    return edit.data[((z * eh + y) * ew + x) * 4 + s] >= 128;
  };
  const member = (s, hu, tc) => {
    const a = segs[s];
    if (!a || !a.enabled) return false;
    if (edit && ((edit.maskOnly >> s) & 1)) return allows(s, tc);
    return hu >= a.min && hu <= a.max && allows(s, tc);
  };
  const at = t => texCoordOf([origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t], halfExt);
  const indexAt = tc => {
    const hu = huAt(tc);
    if (preferred >= 0) return member(preferred, hu, tc) && !(hidden && hidden(preferred, tc)) ? preferred : -1;
    for (let s = 0; s < 4; s++) if (member(s, hu, tc)) return hidden && hidden(s, tc) ? -1 : s;
    return -1;
  };
  let t = Math.max(t0, 0), previousT = t;
  for (let iter = 0; iter < 4096 && t <= endT; iter++) {
    const idx = indexAt(at(t));
    if (idx >= 0) {
      let lo = previousT, hi = t;
      for (let r = 0; r < 5; r++) { const mid = (lo + hi) * 0.5; if (indexAt(at(mid)) === idx) hi = mid; else lo = mid; }
      const tc = at(hi).map(clamp01);
      const [sw, sh, sd] = srcDims;
      let x, y, z;
      if (sw === tw && sh === th && sd === td) { x = Math.min(Math.floor(tc[0] * sw), sw - 1); y = Math.min(Math.floor(tc[1] * sh), sh - 1); z = Math.min(Math.floor(tc[2] * sd), sd - 1); }
      else {
        // a reduced texture: the texel's position mapped onto the source grid (maskVoxelAt of the WebGPU pick)
        const px = Math.min(Math.floor(tc[0] * tw), tw - 1), py = Math.min(Math.floor(tc[1] * th), th - 1), pz = Math.min(Math.floor(tc[2] * td), td - 1);
        x = Math.min(Math.round(px * Math.max(sw - 1, 1) / Math.max(tw - 1, 1)), sw - 1); y = Math.min(Math.round(py * Math.max(sh - 1, 1) / Math.max(th - 1, 1)), sh - 1); z = Math.min(Math.round(pz * Math.max(sd - 1, 1) / Math.max(td - 1, 1)), sd - 1);
      }
      return { x, y, z, slot: idx };
    }
    previousT = t; t += st;
  }
  return null;
}

// an earlier change: the hidden test of pickRay from index grids (each: ids = the index per voxel, x fastest, on grid dims; slotsOf(id) = the slot bits that index hides, 0 = none). null when no layer hides anything.
export function hiddenTestOf(layers) {
  const L = (layers || []).filter(l => l && l.ids && l.dims && l.slotsOf && l.any);
  if (!L.length) return null;
  return (s, tc) => {
    for (const l of L) {
      const [w, h, d] = l.dims, x = Math.min(Math.floor(clamp01(tc[0]) * w), w - 1), y = Math.min(Math.floor(clamp01(tc[1]) * h), h - 1), z = Math.min(Math.floor(clamp01(tc[2]) * d), d - 1);
      const id = l.ids[((z * h + y) * w + x) * (l.stride || 1) + (l.off || 0)]; // stride / off: an RG index array (2, 1 = its G byte)
      if (id && ((l.slotsOf(id) >> s) & 1)) return true;
    }
    return false;
  };
}
