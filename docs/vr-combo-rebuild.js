// showing or hiding a segment in VR rebuilt the combined classification + distance texture (distance-field.js
// combineClassificationDistance, 0.2-0.4 s at 256³) and sent all of it again (64 MB) inside one frame: a freeze of several hundred ms.
// This rebuild runs off the frame. Only the alpha depends on the shown segments (the classification channels are the stored bytes), so
// the new alpha (combinedAlphaRange, one byte per voxel) is computed in a worker (the distance bytes go to it once, one slab per frame;
// without a worker: in chunks on the main thread within a time budget per frame), then written into the texture's bytes and uploaded a
// few z slices per frame (upload(z0, z1): texSubImage3D in vr-view.js). A newer request cancels the one in flight. At the end the bytes
// equal the one-shot combineClassificationDistance result for the mask (unit-tested).
// Correctness while it runs (vr-view.js applyCombo): a texel's alpha is the min over the mask it was last written for, so it is a lower
// bound of the distance to the shown surfaces (all the jump needs) whenever the shown mask is a subset of that mask.
// safeMask = the AND of every mask whose alpha may be in the bytes or on the GPU; jumpsSafe(shown) = shown ⊆ safeMask. Hiding a segment
// keeps the jumps; showing one draws without them (general loop, classification only) until the upload is complete.
// vr-view.js no longer draws the interim without jumps (it cost ~20x a frame); the shader's shown set
// is held inside safeMask instead, so a shown segment appears when its upload is complete. Every per-frame step here stays within budgetMs:
// the distance slabs (1 MB each, several per frame while time is left), the alpha written into the bytes in chunks (an upload once its z slab
// is complete, at most one per frame); the worker's alpha buffer goes back to it for the next build (no 16 MB allocation per change).
// Pure (no DOM / GL; the worker is injected), unit-tested.
import { combinedAlphaRange } from './distance-field.js?v=20261023-build660';

export const UPLOAD_BYTES = 2 << 20, SLAB_BYTES = 1 << 20, CHUNK = 1 << 16, WORKER_CHUNK = 1 << 20, BUDGET_MS = 2, WORKER_FRAMES = 600;

// the worker: keeps a copy of the distance bytes (init + slabs; a known cost: n x C bytes, up to 64 MB at 256³ with four segments, resident until the
// session ends, so that a later change needs no copy), answers build {id, mask, chan, chunk} with the alpha (transferred); a newer
// build or a cancel stops the one running at its next chunk. Self-contained apart from combinedAlphaRange (both go to the worker as source).
export function comboWorkerMain(scope) {
  let dist = null, C = 1, latest = 0, spare = null;
  scope.onmessage = async e => {
    const m = e.data;
    if (m.t === 'init') { dist = new Uint8Array(m.bytes); C = m.C; latest = 0; }
    else if (m.t === 'slab') dist.set(new Uint8Array(m.buf), m.at);
    else if (m.t === 'cancel') latest = 0;
    else if (m.t === 'spare') spare = new Uint8Array(m.buf); // the alpha of the last build, back from the main side once uploaded
    else if (m.t === 'build') {
      // an exception in this async handler would not reach Worker.onerror: it is reported (the main side then goes on by itself)
      try {
        const id = latest = m.id, n = dist.length / C, alpha = spare && spare.length === n ? spare : new Uint8Array(n), src = { data: dist, C }; // every voxel is written below
        spare = null;
        for (let i = 0; i < n; i += m.chunk) {
          if (i > 0) { await new Promise(r => setTimeout(r, 0)); if (latest !== id) { spare = alpha; return; } }
          combinedAlphaRange(src, m.chan, m.mask, alpha, i, Math.min(n, i + m.chunk));
        }
        if (latest === id) scope.postMessage({ t: 'alpha', id, buf: alpha.buffer }, [alpha.buffer]);
      } catch (err) { scope.postMessage({ t: 'error', id: m.id, message: String(err?.message || err) }); }
    }
  };
}
const blobWorker = () => {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  const src = combinedAlphaRange.toString() + '\n(' + comboWorkerMain.toString() + ')(self);';
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), w = new Worker(url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return w;
};

// dist: {data, C} (the classification's distance bytes), chan: cls.chan, dims [w, h, d], data: the combined texture's bytes (w*h*d*4, written in
// place), mask: the mask data holds (-1: unknown / mixed), upload(z0, z1): send slices [z0, z1) of data to the GPU. tick() once per frame;
// it returns true when a rebuild has just completed. A worker that reports an error, fails, or has not answered a build after workerFrames
// frames is dropped and the job goes on on the main thread (the jumps never stay off for the session).
export function createComboRebuild({ dist, chan, dims, data, mask, upload, makeWorker = blobWorker, now = () => performance.now(), budgetMs = BUDGET_MS, uploadBytes = UPLOAD_BYTES, slabBytes = SLAB_BYTES, workerFrames = WORKER_FRAMES }) {
  const plane = dims[0] * dims[1], depth = dims[2], n = plane * depth, C = dist.C, chanA = Array.from(chan);
  let content = mask, safe = mask < 0 ? 0 : mask, job = null, seq = 0, wk = null, broken = false, sent = 0, spare = null;
  const newJob = (mask, target) => ({ id: ++seq, mask, target, alpha: null, buf: null, i: 0, z: 0, w: 0, posted: false });
  // the alpha buffer of a job that is over: the worker's goes back to it (transferred), the main thread's is kept
  const recycle = j => { if (j.buf) spare = j.buf; else if (j.alpha && wk && !broken) { try { wk.postMessage({ t: 'spare', buf: j.alpha.buffer }, [j.alpha.buffer]); } catch { /* dropped */ } } };
  const fail = () => { broken = true; try { wk?.terminate(); } catch { /* gone */ } wk = null; if (job && !job.alpha) { job.posted = false; job.i = 0; } }; // the job goes on on the main thread
  const ensure = () => {
    if (wk || broken) return wk;
    try {
      wk = makeWorker();
      if (!wk) { broken = true; return null; }
      wk.onmessage = e => { const m = e.data; if (m?.t === 'alpha' && job && job.id === m.id && !job.alpha) job.alpha = new Uint8Array(m.buf); else if (m?.t === 'error' && job && job.id === m.id) fail(); }; // an error of a cancelled build does not drop the worker
      wk.onerror = e => { e?.preventDefault?.(); fail(); };
      wk.postMessage({ t: 'init', bytes: dist.data.length, C }); sent = 0;
    } catch { broken = true; wk = null; }
    return wk;
  };
  // one slab of the distance bytes per frame (a copy, transferred): no single large structured clone on the main thread
  const sendSlab = () => {
    if (sent >= dist.data.length) return true;
    const end = Math.min(dist.data.length, sent + slabBytes), buf = dist.data.slice(sent, end).buffer;
    wk.postMessage({ t: 'slab', at: sent, buf }, [buf]); sent = end;
    return false;
  };
  return {
    get busy() { return !!job; },
    get contentMask() { return content; },
    get safeMask() { return safe; },
    jumpsSafe: m => (m & ~safe) === 0,
    request(m) {
      if (job && job.target === m) return;
      if (job) { if (job.posted && wk) wk.postMessage({ t: 'cancel' }); recycle(job); job = null; } // slices already written / uploaded stay (safe has their mask)
      if (m === content) return; // nothing written yet for the cancelled one: the bytes still hold m
      // a set disjoint from safe (a swap, bone only -> soft only) has nothing drawable with the jumps meanwhile: first the union (its alpha
      // is a lower bound for both, safe keeps the old set through that upload), then m itself
      const mid = m !== 0 && safe !== 0 && (m & safe) === 0 ? (m | safe) : m;
      job = newJob(mid, m);
    },
    tick() {
      if (!job) return false;
      if (!job.alpha) {
        const w = ensure();
        if (w) {
          if (!job.posted) { const t0 = now(); let done = false, last = 0; do { const a = now(); done = sendSlab(); last = now() - a; } while (!done && now() - t0 + last < budgetMs); if (done) { w.postMessage({ t: 'build', id: job.id, mask: job.mask, chan: chanA, chunk: WORKER_CHUNK }); job.posted = true; job.waited = 0; } }
          else if (++job.waited > workerFrames) fail();
          return false;
        }
        if (!job.buf) { job.buf = spare && spare.length === n ? spare : new Uint8Array(n); spare = null; }
        const t0 = now();
        do { const e = Math.min(n, job.i + CHUNK); combinedAlphaRange(dist, chanA, job.mask, job.buf, job.i, e); job.i = e; } while (job.i < n && now() - t0 < budgetMs);
        if (job.i >= n) job.alpha = job.buf;
        return false; // the upload starts on the next frame
      }
      // the alpha of slab [z0, z1) written in chunks while time is left (job.w = next voxel), uploaded once complete: at most one upload per frame
      const k = Math.max(1, Math.floor(uploadBytes / (plane * 4))), z0 = job.z, z1 = Math.min(depth, z0 + k), a = job.alpha, e = z1 * plane, t0 = now(), wrote = job.w < e;
      safe &= job.mask; content = -1;
      do { const ce = Math.min(e, job.w + CHUNK); for (let i = job.w; i < ce; i++) data[i * 4 + 3] = a[i]; job.w = ce; } while (job.w < e && now() - t0 < budgetMs);
      if (job.w < e || (wrote && now() - t0 >= budgetMs)) return false; // the budget is spent: the upload goes on the next frame
      upload(z0, z1); job.z = z1;
      if (z1 < depth) return false;
      content = safe = job.mask; recycle(job); const next = job.target; job = null;
      if (next !== content) job = newJob(next, next); // the second step of a swap
      return true;
    },
    dispose() { job = null; spare = null; broken = true; try { wk?.terminate(); } catch { /* gone */ } wk = null; },
  };
}
