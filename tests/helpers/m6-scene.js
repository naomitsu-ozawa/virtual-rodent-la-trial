// The m6 plan's synthetic extras of the 64^3 scene (tools/wgpu-m6-check.mjs): the result index texture, the child segment index texture and the look-up tables of the WebGL harness (tools/lib/vr-gl-harness.mjs renderBatch builds the same
// arrays: regData, childData, lutOf, childLutOf), as plain arrays, so that the WebGL program and the WGSL program are given the same bytes. Rows of the tables: texel i of row r at float offset (r * 256 + i) * 4.
export function regionIndex(N) { // R = the colour index (G = the hide index: the same here), two results side by side in the left half: id 1 for x < N/4, id 2 for N/4 <= x < N/2
  const d = new Uint8Array(N * N * N * 2);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) { const i = (z * N + y) * N + x; d[i * 2] = d[i * 2 + 1] = x < N / 4 ? 1 : 2; }
  return d;
}
export function childIndex(N) { // child 1 for x in [N/8, 3N/8) (overlaps results 1 and 2), child 2 for x in [N/2, 3N/4)
  const d = new Uint8Array(N * N * N * 2);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = (z * N + y) * N + x; const c = x >= N / 8 && x < 3 * N / 8 ? 1 : x >= N / 2 && x < 3 * N / 4 ? 2 : 0; d[i * 2] = d[i * 2 + 1] = c; }
  return d;
}
// the results' table: result 1 and 2 coloured (c1, c2) on the slots of `mask` (bit s), hidden on the slots of `hidden` (bits 8 + s of the texel's a, the shown bits of a hidden result are 0)
export function regionLut({ c1 = [0, 0.85, 1], c2 = [1, 0.4, 0.1], mask = 15, hidden1 = 0, hidden2 = 0 } = {}) {
  const d = new Float32Array(1024);
  for (let i = 1; i < 256; i++) d.set(i === 1 ? [...c1, hidden1 ? hidden1 << 8 : mask] : i === 2 ? [...c2, hidden2 ? hidden2 << 8 : mask] : [1, 1, 1, 15], i * 4);
  return Array.from(d);
}
// the child segments' table: ch = { id: { color, mask (the parent slots it is shown on; 0 = hidden), row1: [lower, upper, flatMask, hiddenMask], row2?: [ambient, spec, shininess, opacity] } }; std = the standard material (ambient, spec, shininess)
export function childLut(ch, std = [0.35, 0.5, 0.15]) {
  const d = new Float32Array(256 * 12);
  for (const [i, e] of Object.entries(ch)) { d.set([...e.color, e.mask], i * 4); d.set(e.row1, 1024 + i * 4); d.set(e.row2 || [std[0], std[1], std[2], 1], 2048 + i * 4); }
  return Array.from(d);
}
