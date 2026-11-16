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
// a request can carry a HIDDEN STATE (hide = one Uint8Array(256) per index source: bit s of entry i = item i is hidden on slot s). The worker then
// also merges (min) into the alpha the distance field of the VISIBLE content of every shown slot that has a hidden part (vr-hide-field.js, which has the safety argument): the class bytes of the stored channels and the
// hide indexes go to it once (setHideSources, one slab per frame, only when something is hidden for the first time). Every byte stays <= the ordinary field of the shown set, so the safe-mask rules below are unchanged and
// the old shader rule (no jump from a hidden sample) is safe for any bytes in the texture; hideValid(cur, shown) says when the shader may drop that rule: no rebuild running, the bytes finished, built for exactly the hidden state
// cur (on the shown slots; hiding MORE than was built is not safe), for a mask that contains what is shown. A change of the mask carries no state (a segment just shown must not wait for the extra pass); the state is asked for again once that job is over (requestHide). Without a worker (or when it fails) the alpha is the ordinary one and hideValid stays false: the picture is as before.
// Pure (no DOM / GL; the worker is injected), unit-tested.
import { combinedAlphaRange, morph3, euclideanDistanceBytes } from './distance-field.js?v=20261113-build735';
import { hiddenClassBytes, hideFieldMin, hideBitsMatch, hideBitsSame, hideBitsAny, hideBitsOn } from './vr-hide-field.js?v=20261113-build735';

export const UPLOAD_BYTES = 2 << 20, SLAB_BYTES = 1 << 20, CHUNK = 1 << 16, WORKER_CHUNK = 1 << 20, BUDGET_MS = 2, WORKER_FRAMES = 600, HIDE_FRAMES = 36000;

// the worker: keeps a copy of the distance bytes (init + slabs; a known cost: n x C bytes, up to 64 MB at 256³ with four segments, resident until the
// session ends, so that a later change needs no copy), answers build {id, mask, chan, chunk, hide} with the alpha (transferred); a newer
// build or a cancel stops the one running at its next chunk.: hinit + harr slabs give it the class bytes and the hide indexes (resident from then on); a build with `hide` merges the visible-content field
// (hideFieldMin, one blocking pass of about a second per slot with a hidden part, off the main thread) and says so in its answer (hide: true). Self-contained apart from the functions listed in comboWorkerSource.
export function comboWorkerMain(scope) {
  let dist = null, C = 1, latest = 0, spare = null, hcls = null, hsrc = null, hdims = null, hchan = null;
  scope.onmessage = async e => {
    const m = e.data;
    if (m.t === 'init') { dist = new Uint8Array(m.bytes); C = m.C; latest = 0; hcls = null; hsrc = null; }
    else if (m.t === 'slab') dist.set(new Uint8Array(m.buf), m.at);
    else if (m.t === 'hinit') { hcls = { data: new Uint8Array(m.n * m.C), C: m.C }; hsrc = Array.from({ length: m.sources }, () => ({ ids: new Uint8Array(m.n), bits: new Uint8Array(256) })); hdims = m.dims; hchan = m.chan; }
    else if (m.t === 'harr') { if (hcls) (m.name === 'cls' ? hcls.data : hsrc[+m.name.slice(1)].ids).set(new Uint8Array(m.buf), m.at); }
    else if (m.t === 'cancel') latest = 0;
    else if (m.t === 'spare') spare = new Uint8Array(m.buf); // the alpha of the last build, back from the main side once uploaded
    else if (m.t === 'build') {
      // an exception in this async handler would not reach Worker.onerror: it is reported (the main side then goes on by itself)
      try {
        const id = latest = m.id, n = dist.length / C, alpha = spare && spare.length === n ? spare : new Uint8Array(n), src = { data: dist, C }; // every voxel is written below
        spare = null;
        for (let i = 0; i < n; i += m.chunk) {
          if (i > 0) { await new Promise(r => setTimeout(r, 0)); if (latest !== id) { spare = alpha; scope.postMessage({ t: 'dropped', id }); return; } }
          combinedAlphaRange(src, m.chan, m.mask, alpha, i, Math.min(n, i + m.chunk));
        }
        let hid = false;
        if (m.hide && hcls && hcls.data.length > 0 && hsrc.length === m.hide.length) { m.hide.forEach((b, k) => hsrc[k].bits.set(b)); await new Promise(r => setTimeout(r, 0)); if (latest !== id) { spare = alpha; scope.postMessage({ t: 'dropped', id }); return; } hideFieldMin(alpha, { cls: hcls, chan: hchan, dims: hdims, mask: m.mask, sources: hsrc }); hid = true; }
        if (latest === id) scope.postMessage({ t: 'alpha', id, buf: alpha.buffer, hide: hid }, [alpha.buffer]);
      } catch (err) { scope.postMessage({ t: 'error', id: m.id, message: String(err?.message || err) }); }
    }
  };
}
export const comboWorkerSource = () => [combinedAlphaRange, morph3, euclideanDistanceBytes, hiddenClassBytes, hideFieldMin, comboWorkerMain].map(f => f.toString()).join('\n') + '\n(' + comboWorkerMain.name + ')(self);';
const blobWorker = () => {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  const url = URL.createObjectURL(new Blob([comboWorkerSource()], { type: 'text/javascript' })), w = new Worker(url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return w;
};

// dist: {data, C} (the classification's distance bytes), chan: cls.chan, dims [w, h, d], data: the combined texture's bytes (w*h*d*4, written in
// place), mask: the mask data holds (-1: unknown / mixed), upload(z0, z1): send slices [z0, z1) of data to the GPU. tick() once per frame;
// it returns true when a rebuild has just completed. A worker that reports an error, fails, or has not answered a build after workerFrames
// frames is dropped and the job goes on on the main thread (the jumps never stay off for the session).
// hide = {cls: {data, C} (the classification bytes), rgs: [the results' index, the children's] (RG bytes, G = the hide index; an entry may be null; n731 perf ③: a source may also be one byte a voxel, the body's cut while parts are out)} makes request(m, bits) accept a hidden state (see the top);
// setHideSources(cls, rgs) replaces them (the child index was rebuilt: what the worker holds and what was built from it are dropped).
export function createComboRebuild({ dist, chan, dims, data, mask, upload, hide = null, makeWorker = blobWorker, now = () => performance.now(), budgetMs = BUDGET_MS, uploadBytes = UPLOAD_BYTES, slabBytes = SLAB_BYTES, workerFrames = WORKER_FRAMES, hideFrames = HIDE_FRAMES }) {
  const plane = dims[0] * dims[1], depth = dims[2], n = plane * depth, C = dist.C, chanA = Array.from(chan);
  let content = mask, safe = mask < 0 ? 0 : mask, job = null, seq = 0, wk = null, broken = false, sent = 0, spare = null, hideOut = 0; // hideOut: the id of a build with a hidden state posted to this worker and not answered yet: it computes it in ONE blocking pass (seconds on a headset), so for that job (and one queued behind it) no answer within workerFrames frames is not yet a failure
  let hcls = hide ? hide.cls : null, hrgs = hide ? hide.rgs : null, hidx = [], hfeed = [], hsent = 0, hat = 0, hinit = false; // the hide inputs: what the worker has to be sent, how far it is
  let contentHide = null, wantMask = mask; // contentHide: the hidden state the finished bytes were built with (null: none, the ordinary field only); wantMask: the mask of the last request
  const setupHide = () => { hidx = []; if (hrgs) hrgs.forEach((r, k) => { if (r && (r.length === n * 2 || r.length === n)) hidx.push(k); }); hfeed = hcls ? [['cls', hcls.data, 1, 0, n * hcls.C], ...hidx.map((k, j) => (hrgs[k].length === n ? ['s' + j, hrgs[k], 1, 0, n] : ['s' + j, hrgs[k], 2, 1, n]))] : []; hsent = 0; hat = 0; hinit = false; }; // an index source: RG bytes (G = the index) or, n731 perf ③, one byte a voxel (the body's cut: vr-part-view.js partBodyHidOf)
  setupHide();
  const bitsFor = b => b ? hidx.map(k => b[k]) : null; // the worker's tables, one per index it holds
  const sameBits = (a, b) => hideBitsSame(a, b);
  const copyBits = b => b ? b.map(x => Uint8Array.from(x)) : null;
  const newJob = (mask, target, bits) => ({ id: ++seq, mask, target, hideOnly: mask >= 0 && mask === content, hide: bits ? copyBits(bits) : null, hideDone: false, alpha: null, buf: null, i: 0, z: 0, w: 0, posted: false });
  // the alpha buffer of a job that is over: the worker's goes back to it (transferred), the main thread's is kept
  const recycle = j => { if (j.buf) spare = j.buf; else if (j.alpha && wk && !broken) { try { wk.postMessage({ t: 'spare', buf: j.alpha.buffer }, [j.alpha.buffer]); } catch { /* dropped */ } } };
  const fail = () => { broken = true; try { wk?.terminate(); } catch { /* gone */ } wk = null; if (job && !job.alpha) { job.posted = false; job.i = 0; job.hide = null; } }; // the job goes on on the main thread (without the hidden state: the ordinary field)
  const ensure = () => {
    if (wk || broken) return wk;
    try {
      wk = makeWorker();
      if (!wk) { broken = true; return null; }
      wk.onmessage = e => { const m = e.data; if (m && m.id === hideOut && (m.t === 'alpha' || m.t === 'error' || m.t === 'dropped')) hideOut = 0; if (m?.t === 'alpha' && job && job.id === m.id && !job.alpha) { job.alpha = new Uint8Array(m.buf); job.hideDone = !!m.hide; } else if (m?.t === 'error' && job && job.id === m.id) fail(); }; // an error of a cancelled build does not drop the worker
      wk.onerror = e => { e?.preventDefault?.(); fail(); };
      wk.postMessage({ t: 'init', bytes: dist.data.length, C }); sent = 0; hsent = 0; hat = 0; hinit = false;
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
  // the same for the hide inputs (class bytes, then each index's G bytes): after the distance bytes, one slab per call, only for a job that carries a hidden state
  const sendHideSlab = () => {
    if (!hfeed.length) return true;
    if (!hinit) { wk.postMessage({ t: 'hinit', n, C: hcls.C, dims: Array.from(dims), chan: chanA, sources: hidx.length }); hinit = true; hsent = 0; hat = 0; }
    if (hsent >= hfeed.length) return true;
    const [name, arr, stride, off, total] = hfeed[hsent], end = Math.min(total, hat + slabBytes);
    let buf;
    if (stride === 1) buf = arr.slice(hat, end).buffer;
    else { const b = new Uint8Array(end - hat); for (let i = hat, o = 0; i < end; i++, o++) b[o] = arr[i * stride + off]; buf = b.buffer; }
    wk.postMessage({ t: 'harr', name, at: hat, buf }, [buf]); hat = end;
    if (hat >= total) { hsent++; hat = 0; }
    return hsent >= hfeed.length;
  };
  return {
    get busy() { return !!job; },
    get contentMask() { return content; },
    get safeMask() { return safe; },
    get contentHide() { return contentHide; },
    // a rebuild that only changes the hidden state (the mask is the one the bytes already have: job.hideOnly): the classification bytes never change, and a creep-skip bit needs only them (a skipped sample is one
    // where every shown channel is below 0.5 at all eight corners: no hit possible whatever the alpha says; the alpha <= 2 part only means the loop would not have jumped either, and a longer jump that is not taken is
    // slower, never wrong), so the skip bits stay valid through it (vr-view.js skipTick). skipContent = the mask the skip bits describe meanwhile.
    get hideOnly() { return !!job && job.hideOnly; },
    get skipContent() { return job && job.hideOnly ? job.mask : content; },
    jumpsSafe: m => (m & ~safe) === 0,
    // may the shader drop the no-jump rule of a hidden sample: no rebuild running (the bytes are final), built for exactly the hidden state `cur` on every shown slot, for a mask that contains `shown` (the slots the shader draws)
    hideValid: (cur, shown) => !job && contentHide !== null && content >= 0 && (shown & ~content) === 0 && hideBitsMatch(contentHide, cur, shown),
    // the hide inputs changed (the child index was rebuilt): the worker's copies and the bytes built from them are dropped
    setHideSources(cls, rgs) { hcls = cls; hrgs = rgs; setupHide(); contentHide = null; if (job && job.hide) { job.hide = null; job.id = ++seq; if (job.posted && wk) { wk.postMessage({ t: 'cancel' }); job.posted = false; job.alpha = null; job.i = 0; } } /* a new number: the answer of the build already posted is not this job's */ if (wk && !broken) { try { wk.postMessage({ t: 'hinit', n: 0, C: 1, dims: [0, 0, 0], chan: chanA, sources: 0 }); } catch { /* dropped */ } } hinit = false; },
    request(m, bits = null) {
      // a hidden state matters only on a shown slot, needs the worker and the index of every item that is hidden (a hidden item whose index is not held would leave its voxels as tissue in the bytes: no state then)
      const staticBits = bits && hfeed.length && !broken && hideBitsAny(bits) && hideBitsOn(bits, m) && bits.every((b, k) => hidx.includes(k) || !hideBitsAny([b])) ? bits : null;
      wantMask = m;
      if (job && job.target === m && sameBits(job.reqBits, staticBits)) return; // the job in flight is already for this mask and state (a swap's first step carries no state: finalHide is the state of its second)
      if (job) { if (job.posted && wk) wk.postMessage({ t: 'cancel' }); recycle(job); job = null; } // slices already written / uploaded stay (safe has their mask)
      // the state is built only when the mask does not change: a segment just shown must not wait for the extra pass (hideTick asks for the state once the mask job is over)
      const wantBits = staticBits && m === content ? staticBits : null;
      if (m === content && sameBits(contentHide, wantBits)) return; // nothing written yet for the cancelled one: the bytes still hold m
      // a set disjoint from safe (a swap, bone only -> soft only) has nothing drawable with the jumps meanwhile: first the union (its alpha
      // is a lower bound for both, safe keeps the old set through that upload), then m itself
      const mid = m !== 0 && safe !== 0 && (m & safe) === 0 ? (m | safe) : m;
      job = newJob(mid, m, mid === m ? wantBits : null); job.finalHide = wantBits; job.reqBits = staticBits ? copyBits(staticBits) : null;
    },
    // the hidden state changed with the mask the same: rebuild the bytes for it (only when it is worth it: something is hidden on a shown slot, or the bytes hold an old one)
    requestHide(bits) { if (!hfeed.length) return; this.request(wantMask, bits); },
    tick() {
      if (!job) return false;
      if (!job.alpha) {
        const w = ensure();
        if (w) {
          if (!job.posted) {
            const t0 = now(); let done = false, last = 0;
            do { const a = now(); done = sendSlab() && (!job.hide || sendHideSlab()); last = now() - a; } while (!done && now() - t0 + last < budgetMs);
            if (done) { w.postMessage({ t: 'build', id: job.id, mask: job.mask, chan: chanA, chunk: WORKER_CHUNK, hide: job.hide ? bitsFor(job.hide) : null }); job.posted = true; job.waited = 0; if (job.hide) hideOut = job.id; }
          }
          else if (++job.waited > (job.hide || hideOut ? hideFrames : workerFrames)) fail(); // the long limit only for a job that carries a hidden state, or one queued behind such a build that has not answered
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
      safe &= job.mask; content = -1; contentHide = null;
      do { const ce = Math.min(e, job.w + CHUNK); for (let i = job.w; i < ce; i++) data[i * 4 + 3] = a[i]; job.w = ce; } while (job.w < e && now() - t0 < budgetMs);
      if (job.w < e || (wrote && now() - t0 >= budgetMs)) return false; // the budget is spent: the upload goes on the next frame
      upload(z0, z1); job.z = z1;
      if (z1 < depth) return false;
      content = safe = job.mask; contentHide = job.hideDone && job.hide ? job.hide : null; recycle(job); const next = job.target, nextHide = job.finalHide; job = null;
      if (next !== content) job = newJob(next, next, nextHide); // the second step of a swap (it carries the hidden state)
      return true;
    },
    dispose() { job = null; spare = null; broken = true; try { wk?.terminate(); } catch { /* gone */ } wk = null; },
  };
}
