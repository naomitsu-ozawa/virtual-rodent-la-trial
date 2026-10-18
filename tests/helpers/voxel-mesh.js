// Small voxel-mesh toolkit for the surface smoothing tests: binary masks -> voxel-face triangles -> welded mesh, and the
// metrics the smoothing is judged by (plane residual, volume, thickness, watertightness). No three.js.

export function makeMask(w, h, d, inside) {
  const m = new Uint8Array(w * h * d);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5, z + 0.5)) m[z * w * h + y * w + x] = 1;
  return m;
}

export function voxelFaces(m, w, h, d, { boundary = true, zFrom = 0, zTo = d } = {}) {
  const out = [], owner = [];
  const q = (z, ...v) => { out.push(...v); owner.push(z); };
  for (let z = zFrom; z < zTo; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = z * w * h + y * w + x; if (!m[i]) continue;
    const x0 = x, x1 = x + 1, y0 = y, y1 = y + 1, z0 = z, z1 = z + 1;
    if (x > 0 ? !m[i - 1] : boundary) q(z, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y0, z0, x0, y1, z1, x0, y1, z0);
    if (x < w - 1 ? !m[i + 1] : boundary) q(z, x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z0, x1, y1, z1, x1, y0, z1);
    if (y > 0 ? !m[i - w] : boundary) q(z, x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z0, x1, y0, z1, x0, y0, z1);
    if (y < h - 1 ? !m[i + w] : boundary) q(z, x0, y1, z0, x0, y1, z1, x1, y1, z1, x0, y1, z0, x1, y1, z1, x1, y1, z0);
    if (z > 0 ? !m[i - w * h] : boundary) q(z, x0, y0, z0, x0, y1, z0, x1, y1, z0, x0, y0, z0, x1, y1, z0, x1, y0, z0);
    if (z < d - 1 ? !m[i + w * h] : boundary) q(z, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y0, z1, x1, y1, z1, x0, y1, z1);
  }
  return { positions: new Float32Array(out), owner };
}

// weld by exact position (as indexedGeometryFromTrianglePositions)
export function weld(positions) {
  const n = positions.length / 3, map = new Map(), pos = [], idx = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    const k = positions[v * 3] + ',' + positions[v * 3 + 1] + ',' + positions[v * 3 + 2];
    let id = map.get(k);
    if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]); }
    idx[v] = id;
  }
  return { pos: new Float32Array(pos), idx };
}

export function vertexNormals(pos, idx) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2], acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  for (let i = 0; i < out.length; i += 3) { const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
  return out;
}

export function volume(pos, idx) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) + pos[a + 1] * (pos[b + 2] * pos[c] - pos[b] * pos[c + 2]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

// edges used by one triangle only (open boundary) and edges used by more than two
export function edgeCounts(idx) {
  const edges = new Map();
  for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = idx[i + e], b = idx[i + (e + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a;
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  let boundary = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) boundary++; else if (c !== 2) nonManifold++; }
  return { edges: edges.size, boundary, nonManifold };
}

// distance of vertices to the plane z = z0 + slope x, inside the x / y margins: peak-to-peak and rms
export function planeStats(pos, slope, W, H, z0, marginX = 12, marginY = 4) {
  const nl = Math.hypot(slope, 1); let min = Infinity, max = -Infinity, sq = 0, c = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < marginX || x > W - marginX || y < marginY || y > H - marginY) continue;
    const dist = ((z - z0) - slope * x) / nl; if (dist < min) min = dist; if (dist > max) max = dist; sq += dist * dist; c++;
  }
  return { pp: max - min, rms: Math.sqrt(sq / c), n: c };
}

// thickness of a thin structure along `axis`: for vertices whose normal points along +axis, the distance to the nearest
// vertex of the opposite sheet within lateral radius `lat`
export function thickness(pos, nrm, axis, lat, region) {
  const n = pos.length / 3, top = [], bot = [];
  for (let i = 0; i < n; i++) { const o = i * 3; if (!region(pos[o], pos[o + 1], pos[o + 2])) continue; if (nrm[o + axis] > 0.7) top.push(i); else if (nrm[o + axis] < -0.7) bot.push(i); }
  const other = [0, 1, 2].filter(a => a !== axis), vals = [];
  for (const i of top) {
    const o = i * 3; let best = Infinity;
    for (const j of bot) { const p = j * 3, du = pos[o + other[0]] - pos[p + other[0]], dv = pos[o + other[1]] - pos[p + other[1]]; if (du * du + dv * dv > lat * lat) continue; const t = pos[o + axis] - pos[p + axis]; if (t < best) best = t; }
    if (best < Infinity) vals.push(best);
  }
  vals.sort((a, b) => a - b);
  return { min: vals[0], med: vals[vals.length >> 1], max: vals[vals.length - 1], n: vals.length };
}
