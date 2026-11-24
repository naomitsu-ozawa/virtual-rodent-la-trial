// Two ways to make the WebGPU volume march read less memory, as variants of the performance record's shadow passes (docs/vr-wgpu.js beginBreakdown / shadowPass; the display is not changed):
//   distSplit (A7): the distance byte dd (the alpha of the combined classification + distance texture, 256^3 rgba8 = 64 MB) is also kept in a texture of its own (r8unorm, 16 MB). The march reads that one while it
//     jumps; the class vector (the combined texture) is read only at a sample that is not jumped from. The values are the same bytes through the same linear sampler, so the jumps, hits and the picture are the same.
//   march2 / march2c4 (A6): a coarse grid (cells of 8 / 4 voxels: 32^3 / 64^3 r8unorm, 32 / 256 KB, one cache-resident read) holds, per cell, a LOWER BOUND of dd over the whole cell. While the coarse bound is large
//     the march jumps by it without reading the big texture; where it is small (near a surface) the march does what the display does (the fine distance and class read).
// Why the picture is the same (the contract the unit tests tie, tests/unit/vr-wgpu-coarse-march.test.js):
//   - The march samples the ray at the grid t0 + k * stp. A jump by dd lands on grid point k + m, m = max(1, floor((dd - 1.8) * jkA / stp)), and is taken only when dd >= 2.7. The byte is a floor of the Euclidean distance to the
//     nearest surface-seed voxel of either side (docs/distance-field.js: outside -> nearest inside and inside -> nearest outside), so a jump from a sample OUTSIDE every shown segment lands before the first sample inside a
//     shown segment, k*: the ray is stepped from there, and the hit is the first point inside. A jump by a smaller dd' <= dd is shorter along the same ray, so it lands at or before the display's landing and cannot skip a point inside.
//   - The coarse value of a cell is the minimum of the distance bytes of every texel a trilinear sample at a point of the cell can read (see coarseMinRange: the footprint of x is the texels floor(x - 1/2) and
//     floor(x - 1/2) + 1, clamped to the grid; for x in [cell * C, (cell + 1) * C) that is the texel range [cell * C - 1, (cell + 1) * C], clamped). The interpolated dd is a convex combination of those bytes, so it is
//     >= the minimum; the block also covers x in [cell * C - 1/2, (cell + 1) * C + 1/2), so a rounding of the cell index at a boundary (float products, the sampler's fixed-point coordinates) stays inside it.
//   - A ray that STARTS inside a shown segment is not covered by that argument: the distance is two-sided, so the display jumps through the segment's inside and its hit is the first sample it reads after a jump that is inside
//     (the grid point it lands on), which depends on every jump before it. So march2 does no coarse jump until a sample it has read with the display's own read is outside every shown segment (outSeen): up to that sample the walk
//     is the display's, step for step. This also covers the entry sample of a ray that enters through a box face (the display reads its class there), and a pass without jumps (jumpOn 0) does not use the coarse grid.
//   - Even from outside, the state the search / gradient start from (prevValid, previousT) is that of a step when the point before k* was read; the display's own jump can land on k* itself only through the margin of the distance field
//     (a few in a hundred thousand rays of a model with inside-start rays left out: none), and the unit tests check that the two walks agree on every ray tried.
// Not reached by this: a ray that needs more than the display's 4096 loop iterations (a coarse bound is shorter than the fine jump, so a ray near that limit could end sooner than the display's). The picture comparison
// (pixels that differ from the display's low pass in the same frame) in the record would show it.
// The grids are made on the CPU from the texture's own bytes (chunked over frames: step()) and put on the GPU once per version of the combined texture; a GPU build (compute) is the way to make them for the display.

export const MARCH_JUMP_MARGIN = 1.8, MARCH_JUMP_MIN = 2.7; // the display's own constants (vr-wgsl-core.js: m = floor((dd - 1.8) * jkA / stp) for dd >= 2.7)
// the variants: kind -> { cell: the coarse cell in voxels (0 = no coarse grid), minD: the coarse bound from which the march jumps by it (never below the display's 2.7) }
export const MARCH_VARIANTS = {
  distSplit: { cell: 0, minD: 0 },
  march2: { cell: 8, minD: 8 },
  march2c4: { cell: 4, minD: 4 },
};
export const MARCH_CELLS = [...new Set(Object.values(MARCH_VARIANTS).map(v => v.cell).filter(c => c > 0))]; // [8, 4]
export const MARCH_BINDINGS = { group: 1, dist: 0, coarse: 1 }; // @group(1): the distance texture (r8unorm, 3d, the combined texture's size) and the coarse grid (r8unorm, 3d, ceil(size / cell))

// ---- the data (pure: no GPU) ----
// the alpha (distance) bytes of the combined texture's z slices [z0, z1) into out (one byte a texel, the same x / y / z order as the texture)
export function extractDistPlane(data, dims, out, z0, z1) {
  const wh = dims[0] * dims[1];
  for (let i = z0 * wh, j = z0 * wh * 4 + 3, e = z1 * wh; i < e; i++, j += 4) out[i] = data[j];
}
export const coarseDims = (dims, cell) => [Math.ceil(dims[0] / cell), Math.ceil(dims[1] / cell), Math.ceil(dims[2] / cell)];
// the texel range [lo, hi] (inclusive, clamped to the grid) of one axis that a trilinear sample at a point of cell c (x in [c * cell, (c + 1) * cell)) can read
export const coarseRange = (c, cell, n) => [Math.max(0, c * cell - 1), Math.min(n - 1, (c + 1) * cell)];
// the coarse bound of the cells with z index in [cz0, cz1) into out (cw * ch * cd bytes, x fastest): the minimum of dist over each cell's texel block (separable: z, then y, then x)
export function coarseMinRange(dist, dims, cell, cz0, cz1, out) {
  const [w, h, d] = dims, [cw, ch] = coarseDims(dims, cell), wh = w * h, plane = new Uint8Array(wh), rows = new Uint8Array(ch * w);
  for (let cz = cz0; cz < cz1; cz++) {
    const [z0, z1] = coarseRange(cz, cell, d);
    plane.set(dist.subarray(z0 * wh, (z0 + 1) * wh));
    for (let z = z0 + 1; z <= z1; z++) for (let i = 0, j = z * wh; i < wh; i++, j++) { const v = dist[j]; if (v < plane[i]) plane[i] = v; }
    for (let cy = 0; cy < ch; cy++) {
      const [y0, y1] = coarseRange(cy, cell, h), r = cy * w;
      rows.set(plane.subarray(y0 * w, (y0 + 1) * w), r);
      for (let y = y0 + 1; y <= y1; y++) for (let x = 0, j = y * w; x < w; x++, j++) { const v = plane[j]; if (v < rows[r + x]) rows[r + x] = v; }
      for (let cx = 0; cx < cw; cx++) {
        const [x0, x1] = coarseRange(cx, cell, w); let m = rows[r + x0];
        for (let x = x0 + 1; x <= x1; x++) { const v = rows[r + x]; if (v < m) m = v; }
        out[(cz * ch + cy) * cw + cx] = m;
      }
    }
  }
}
export function coarseMinGrid(dist, dims, cell) {
  const [cw, ch, cd] = coarseDims(dims, cell), out = new Uint8Array(cw * ch * cd);
  coarseMinRange(dist, dims, cell, 0, cd, out);
  return out;
}
// the grids of one combined texture, made a little at a time (step(budget) = about `budget` texel reads per call; true = finished). data = the texture's rgba bytes; dims = [w, h, d]; cells = the coarse cell sizes wanted.
// onDistSlab(z0, z1) is called after the distance bytes of slices [z0, z1) are in `dist` (the host puts them on the GPU). dist = the one byte a texel plane, coarse = Map(cell -> bytes).
export function createMarchGridBuilder({ data, dims, cells = MARCH_CELLS, onDistSlab = null }) {
  const [w, h, d] = dims, wh = w * h, dist = new Uint8Array(wh * d), coarse = new Map(), next = new Map();
  for (const c of cells) { const cd = coarseDims(dims, c); coarse.set(c, new Uint8Array(cd[0] * cd[1] * cd[2])); next.set(c, 0); }
  let zDone = 0, done = false;
  const step = (budget = 1500000) => {
    let left = budget;
    while (!done) {
      if (zDone < d) {
        if (left <= 0) break;
        const n = Math.max(1, Math.min(d - zDone, Math.floor(left / wh)));
        extractDistPlane(data, dims, dist, zDone, zDone + n); onDistSlab?.(zDone, zDone + n); zDone += n; left -= n * wh;
        continue;
      }
      let pending = false;
      for (const c of cells) {
        const cz = next.get(c), cd = coarseDims(dims, c)[2];
        if (cz >= cd) continue;
        pending = true;
        if (left <= 0) break;
        coarseMinRange(dist, dims, c, cz, cz + 1, coarse.get(c)); next.set(c, cz + 1); left -= (c + 2) * wh;
      }
      if (!pending) done = true; else if (left <= 0) break;
    }
    return done;
  };
  return { step, dist, coarse, dims, get done() { return done; }, get zDone() { return zDone; } };
}

// ---- the WGSL of the variants: exact substitutions in the display variant's text (an anchor that is not found exactly once throws) ----
const subOnce = (t, from, to) => {
  const parts = t.split(from);
  if (parts.length !== 2) throw new Error('march variants: anchor found ' + (parts.length - 1) + ' times, expected 1: ' + from.slice(0, 70));
  return parts.join(to);
};
const F = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));
// base = volumeWgsl({ f16, cls4, events: false }) (a variant with section planes is not supported: its slices and cut face are visited at the loop's grid points); kind = a key of MARCH_VARIANTS
export function marchWgsl(base, kind) {
  const v = MARCH_VARIANTS[kind];
  if (!v) throw new Error('march variants: unknown kind ' + kind);
  if (/variant f16=\w+ cls4=\w+ events=true/.test(base)) throw new Error('march variants: the section-plane variant is not supported');
  let t = base;
  t = subOnce(t, '@group(0) @binding(9) var proxyTex:texture_2d<f32>;\n', '@group(0) @binding(9) var proxyTex:texture_2d<f32>;\n'
    + '@group(' + MARCH_BINDINGS.group + ') @binding(' + MARCH_BINDINGS.dist + ') var distTex:texture_3d<f32>;\n@group(' + MARCH_BINDINGS.group + ') @binding(' + MARCH_BINDINGS.coarse + ') var coarseTex:texture_3d<f32>;\n'
    + (v.cell ? 'const COARSE_CELL:f32=' + F(v.cell) + ';\nconst COARSE_MIN:f32=' + F(Math.max(v.minD, MARCH_JUMP_MIN)) + ';\n' : ''));
  if (kind === 'distSplit') {
    // the distance from the 1-byte texture; the class vector is read at the entry sample of a ray (the display's face rule needs it before the jump) and otherwise only when the sample is not jumped from
    t = subOnce(t, 'var q=textureSampleLevel(clsTex,smp,tcS,0.0);var dd=q.a*255.0;', 'var dd=textureSampleLevel(distTex,smp,tcS,0.0).r*255.0;var q=vec4<f32>(0.0);var haveQ=false;');
    t = subOnce(t, 'if(dd>=2.7&&t<=faceT){\n   var qf=q;', 'if(dd>=2.7&&t<=faceT){\n   q=textureSampleLevel(clsTex,smp,tcS,0.0);haveQ=true;var qf=q;');
    t = subOnce(t, 'prevValid=false;k+=m;continue;}\n', 'prevValid=false;k+=m;continue;}\n  if(!haveQ){q=textureSampleLevel(clsTex,smp,tcS,0.0);}\n');
  } else {
    // the coarse jump goes before the display's read of the sample: where the coarse bound is at least COARSE_MIN the same jump formula runs on it (a bound <= the display's dd at this sample)
    const f16 = /variant f16=true/.test(base), cls4 = /cls4=true/.test(base), FM = f16 ? 'f16' : 'f32', FM4 = 'vec4<' + FM + '>';
    t = subOnce(t, 'var prevValid=false;var prevF=0.0;\n', 'var prevValid=false;var prevF=0.0;var outSeen=false;\n'); // outSeen: a sample read with the display's own read has been outside every shown segment (the coarse jumps start then: see the header)
    // the display's inside test of the class vector (the one of its face rule) on the first samples, until one is outside
    t = subOnce(t, 'var q=textureSampleLevel(clsTex,smp,tcS,0.0);var dd=q.a*255.0;\n', 'var q=textureSampleLevel(clsTex,smp,tcS,0.0);var dd=q.a*255.0;\n'
      + '  if(!outSeen){var qo=q;' + (cls4 ? 'qo.a=textureSampleLevel(cls4Tex,smp,clamp(tcS,vec3<f32>(0.0),vec3<f32>(0.999999)),0.0).r;' : '') + '\n'
      + '   let qoc=' + FM4 + '(qo-vec4<f32>(0.5));\n'
      + '   outSeen=!(max(max(dot(qoc,sel0)-off0,dot(qoc,sel1)-off1),max(dot(qoc,sel2)-off2,dot(qoc,sel3)-off3))>=' + FM + '(0.0));}\n');
    t = subOnce(t, '  let tcS=cl(tcO+tcD*t);\n', '  let tcS=cl(tcO+tcD*t);\n'
      + '  if(outSeen&&u.jumpOn!=0){\n'
      + '   let cc=min(vec3<i32>(floor(tcS*vec3<f32>(textureDimensions(clsTex))/COARSE_CELL)),vec3<i32>(textureDimensions(coarseTex))-vec3<i32>(1));\n'
      + '   let dc=floor(textureLoad(coarseTex,cc,0).r*255.0+0.5);\n'
      + '   if(dc>=COARSE_MIN){let m=max(1,i32(floor((dc-' + F(MARCH_JUMP_MARGIN) + ')*jkA/stp)));let nextJ=t0+f32(k+m)*stp;jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;chk=false;k+=m;continue;}\n'
      + '  }\n');
  }
  return t.replace(/(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 march=' + kind + '\n');
}

// ---- the GPU side (used by docs/vr-wgpu.js createVolumeGpu): the group-1 layout, the grids as textures, the bind group per variant ----
// device = the GPUDevice, bgl0 = the volume pass's group-0 layout. prepare(tex, gen, data, dims, cellsWanted) -> 'ready' | 'wait' | null (null: this texture cannot be used: no bytes on the CPU, another format)
// cells = the coarse cell sizes the host makes grids for (default: all, as the performance record's variants need); the DISPLAY's host (docs/vr-wgpu-newpath.js) passes [] : it keeps the distance texture only (distSplit does not read the grid), and a 1 x 1 x 1 stand-in fills the grid's binding
export function createMarchHost({ device, bgl0, cells = MARCH_CELLS }) {
  let layout = null, st = null, dummyCoarse = null;
  const layouts = () => {
    if (!layout) {
      const bgl = device.createBindGroupLayout({ entries: [MARCH_BINDINGS.dist, MARCH_BINDINGS.coarse].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } })) });
      layout = { bgl, pipeLayout: device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl] }) };
    }
    return layout;
  };
  const kill = () => { if (!st) return; try { st.dist.destroy(); st.coarse.forEach(x => x.destroy()); } catch { /* gone */ } st = null; };
  const killAll = () => { kill(); try { dummyCoarse?.destroy(); } catch { /* gone */ } dummyCoarse = null; };
  const mk3 = (size, usage) => device.createTexture({ size, dimension: '3d', format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const put = (tex, bytes, z0, z1, w, h) => device.queue.writeTexture({ texture: tex, origin: [0, 0, z0] }, bytes.subarray(z0 * w * h, z1 * w * h), { bytesPerRow: w, rowsPerImage: h }, [w, h, z1 - z0]);
  // tex = the combined texture's object (a new object, or a new gen = bytes written since: made again); data = its rgba bytes on the CPU
  const prepare = (tex, gen, data, dims) => {
    if (!data || !dims || data.length !== dims[0] * dims[1] * dims[2] * 4) return null;
    if (st && (st.tex !== tex || st.gen !== gen || st.dims.some((x, i) => x !== dims[i]))) kill();
    if (!st) {
      const dist = mk3(dims, 0), b = createMarchGridBuilder({ data, dims, cells, onDistSlab: (z0, z1) => put(dist, b.dist, z0, z1, dims[0], dims[1]) });
      st = { tex, gen, dims: dims.slice(), dist, builder: b, coarse: new Map(), groups: new Map(), ready: false };
    }
    if (!st.ready) {
      if (!st.builder.step()) return 'wait';
      for (const [c, bytes] of st.builder.coarse) { const cd = coarseDims(dims, c), t = mk3(cd, 0); put(t, bytes, 0, cd[2], cd[0], cd[1]); st.coarse.set(c, t); }
      st.ready = true;
      if (!cells.length) st.builder = null; // the display's host: the CPU copy of the distance bytes is not kept once they are on the GPU
    }
    return 'ready';
  };
  // the group-1 bind group of a variant (a distSplit pass takes the first cell's grid: it does not read it)
  const group = kind => {
    if (!st?.ready) return null;
    const cell = MARCH_VARIANTS[kind].cell || cells[0] || 0;
    let g = st.groups.get(cell);
    if (!g) {
      const grid = st.coarse.get(cell) || (dummyCoarse ||= (() => { const t = mk3([1, 1, 1], 0); put(t, new Uint8Array(1), 0, 1, 1, 1); return t; })()); // a display host has no grid: the stand-in (never read: distSplit does not touch it)
      g = device.createBindGroup({ layout: layouts().bgl, entries: [{ binding: MARCH_BINDINGS.dist, resource: st.dist.createView({ dimension: '3d' }) }, { binding: MARCH_BINDINGS.coarse, resource: grid.createView({ dimension: '3d' }) }] });
      st.groups.set(cell, g);
    }
    return g;
  };
  // the DISPLAY's host: bytes [z0, z1) of the combined texture were written to the GPU (docs/vr-wgpu.js writeRange, the same call): the distance texture's same slices are written from the same bytes, and the host's version follows
  // (gen = the entry's new write number), so prepare() finds nothing to make again. A host whose distance texture is not complete (a write while it is being made: it is made again from the new version), another texture or another size is left alone: false.
  // A write of more than maxTexels texels is not copied here (a hitch on the frame): the host is let go and made again, a slab a frame, by prepare().
  const writeRange = (tex, gen, bytes, z0, z1, maxTexels = 4 << 20) => {
    if (!st || st.tex !== tex || !st.ready) return false;
    const [w, h, d] = st.dims, wh = w * h;
    if (z1 <= z0 || z0 < 0 || z1 > d || bytes.length < z1 * wh * 4) return false;
    if ((z1 - z0) * wh > maxTexels) { kill(); return false; }
    const n = z1 - z0, slab = new Uint8Array(n * wh); // the alpha bytes of the written slices, put on the GPU from a slab of their own (a display host keeps no CPU copy of the 16 MB texture)
    for (let i = 0, j = z0 * wh * 4 + 3; i < slab.length; i++, j += 4) slab[i] = bytes[j];
    device.queue.writeTexture({ texture: st.dist, origin: [0, 0, z0] }, slab, { bytesPerRow: w, rowsPerImage: h }, [w, h, n]);
    st.gen = gen;
    return true;
  };
  return { layouts, prepare, group, writeRange, destroy: killAll, get state() { return st; } };
}
