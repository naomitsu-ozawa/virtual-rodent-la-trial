// Device-local cache of the finished VR data: the output of prepareVrData (the 256 copy, the bricks of both grids, the classification bytes, the distance field,
// the combined texture, the fourth channel, the processing mask, the analysis index, the brick occupancy), so that opening the same data again (a switch between practice
// levels, or the next VR start) reads it from the device instead of computing it (the distance field alone is ~7 s of worker time on a desktop CPU, several times that on a Quest).
//
// Two entries per data, in the same IndexedDB database as the filtered 3D volume (gpu-volume-cache.js: same LRU budget, same "clear cache" button, listed in settings > cache as
// 「VR用データ」):
//   vr-volume   what only the data decides: the 256 copy, the bricks of both grids. Key: dataset fingerprint + filter signature + VR grid plan + format.
//   vr-derived  what the segments / processing masks / analysis results decide: the processing mask, the classification bytes, the distance field, the combined texture, the fourth
//               channel, the analysis index, the occupancy. Key: the vr-volume key + a hash of every input of that step (segment ranges and slots, the runs of the masks and of the shown
//               analysis results, the shown-segment mask), so any change the user made gives another key and the step is computed again (and stored under the new key).
// The 512 grid itself (vd.data) is NOT stored: the page reads it from its own (already cached) 3D volume and it is as large as everything else together.
//
// A stored entry is a manifest (JSON) in slice 0 and the arrays cut into CHUNK-byte slices after it. Writing is paced (a few ms of work, then a pause) and can be cancelled between
// two slices (the data was released): a half-written entry is removed. Reading is a few slices at a time. Every failure (no space, a damaged entry) means "not cached".
export const VR_CACHE_FORMAT = 1;
export const CHUNK = 1 << 20;
const TYPES = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array };
const enc = new TextEncoder();

// canonical bytes of any value (typed arrays raw, objects with sorted keys): the input of a hash that must not depend on property order or on the object's identity
function walk(v, out) {
  if (v === null || v === undefined || typeof v !== 'object') { const s = typeof v === 'string' ? v : String(v); out.push('s' + typeof v + s.length + ':' + s + ';'); return; }
  if (ArrayBuffer.isView(v)) { out.push('T' + v.constructor.name + v.length + ':'); out.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return; }
  if (Array.isArray(v)) { out.push('A' + v.length + '['); for (const x of v) walk(x, out); out.push(']'); return; }
  out.push('O{'); for (const k of Object.keys(v).sort()) { out.push(k.length + ':' + k + '='); walk(v[k], out); } out.push('}');
}
export function canonicalBytes(value) {
  const parts = []; walk(value, parts);
  const bufs = parts.map(p => typeof p === 'string' ? enc.encode(p) : p), n = bufs.reduce((a, b) => a + b.byteLength, 0), all = new Uint8Array(n);
  let o = 0; for (const b of bufs) { all.set(b, o); o += b.byteLength; }
  return all;
}
export async function hashHex(value, subtle = globalThis.crypto?.subtle) {
  const d = new Uint8Array(await subtle.digest('SHA-256', canonicalBytes(value)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

// arrays: [[name, typedArray | null]]. meta: JSON-able. -> a packed entry: slice i comes from sliceOf(packed, i)
export function packEntry(meta, arrays) {
  const list = arrays.filter(([, a]) => a && a.byteLength), descs = list.map(([name, a]) => ({ name, type: a.constructor.name, length: a.length, bytes: a.byteLength, chunks: Math.ceil(a.byteLength / CHUNK) }));
  for (const d of descs) if (!TYPES[d.type]) throw new Error('vr cache: unsupported array type ' + d.type);
  const manifest = enc.encode(JSON.stringify({ format: VR_CACHE_FORMAT, meta, arrays: descs })), index = [{ m: true }];
  list.forEach(([, a], ai) => { for (let c = 0; c < descs[ai].chunks; c++) index.push({ ai, c }); });
  return { slices: index.length, bytes: manifest.byteLength + descs.reduce((a, d) => a + d.bytes, 0), manifest, list, index, descs };
}
// a COPY (a structured clone of a view would copy its whole buffer)
export function sliceOf(packed, i) {
  const e = packed.index[i];
  if (e.m) return packed.manifest.slice();
  const a = packed.list[e.ai][1], u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  return u8.slice(e.c * CHUNK, Math.min(a.byteLength, (e.c + 1) * CHUNK));
}

// store: begin, paced writes, commit. isCancelled() is asked before every slice. -> true when the entry is complete
export async function storeEntry(cache, key, info, packed, { isCancelled = () => false, now = () => performance.now(), pause = ms => new Promise(r => setTimeout(r, ms)), budgetMs = 3, idleMs = 14 } = {}) {
  let writer = null;
  try {
    writer = await cache.begin(key, { slices: packed.slices, bytesPerSlice: Math.ceil(packed.bytes / packed.slices), info });
    let t = now();
    for (let i = 0; i < packed.slices; i++) {
      if (isCancelled()) { await writer.abort(); return false; }
      await writer.write(i, sliceOf(packed, i));
      if (now() - t >= budgetMs) { await pause(idleMs); t = now(); }
    }
    if (isCancelled()) { await writer.abort(); return false; }
    await writer.commit();
    return true;
  } catch (e) { try { await writer?.abort(); } catch { /* none */ } console.warn('VR data cache: store failed', e); return false; }
}

// load: lookup, then the manifest, then the chunks (concurrency at a time) straight into freshly allocated arrays. -> {meta, arrays: {name: typedArray}} | null
export async function loadEntry(cache, key, { concurrency = 3, isCancelled = () => false } = {}) {
  try {
    const hit = await cache.lookup(key); if (!hit) return null;
    const mb = await cache.read(key, 0); if (!mb) { await cache.remove(key); return null; }
    const mf = JSON.parse(new TextDecoder().decode(mb)); if (mf.format !== VR_CACHE_FORMAT) { await cache.remove(key); return null; }
    const total = 1 + mf.arrays.reduce((a, d) => a + d.chunks, 0); if (hit.slices !== total) { await cache.remove(key); return null; }
    const arrays = {}, jobs = []; let idx = 1;
    for (const d of mf.arrays) {
      const T = TYPES[d.type]; if (!T) { await cache.remove(key); return null; }
      const a = new T(d.length), u8 = new Uint8Array(a.buffer); arrays[d.name] = a;
      for (let c = 0; c < d.chunks; c++) jobs.push({ i: idx++, u8, off: c * CHUNK, len: Math.min(d.bytes, (c + 1) * CHUNK) - c * CHUNK });
    }
    let next = 0, bad = false;
    const lane = async () => { while (next < jobs.length && !bad) { if (isCancelled()) { bad = true; return; } const j = jobs[next++], b = await cache.read(key, j.i); if (!b || b.byteLength !== j.len) { bad = true; return; } j.u8.set(b instanceof Uint8Array ? b : new Uint8Array(b), j.off); } };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
    if (bad) { if (!isCancelled()) { try { await cache.remove(key); } catch { /* none */ } } return null; }
    return { meta: mf.meta, arrays };
  } catch (e) { console.warn('VR data cache: read failed', e); try { await cache.remove(key); } catch { /* none */ } return null; }
}

// the other entries of the same kind, dataset and filter that are not `keep` (an older state of the same data): removed (the cache keeps the latest)
export async function pruneSiblings(cache, info, keep) {
  const same = d => JSON.stringify(d ?? null);
  try { for (const e of await cache.list()) { const i = e.info || {}; if (e.key !== keep && i.kind === info.kind && same(i.dataset) === same(info.dataset) && i.filter === info.filter) await cache.remove(e.key); } }
  catch (e) { console.warn('VR data cache: prune failed', e); }
}
