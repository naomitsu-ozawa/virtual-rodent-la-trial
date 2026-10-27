// switching the data (a practice dataset / level) INSIDE a running VR session, without ending the session and without a frame that
// stalls the headset. Pure: no DOM, no GL, no three.js (the pieces are injected); unit-tested (tests/unit/vr-data-switch.test.js). vr-view.js wires it.
//   createSwapGuard    generation numbers: a switch that was overtaken (another one started, the session ended) drops its results
//   runDataSwap        the ORDER of a switch (hide + free the old data, open the new one on the page, prepare off the main thread, upload in slices, show, refine)
//   createUploadQueue  GPU uploads in slices, a few ms per frame (texSubImage3D of z slabs through the injected copy)
//   createSettleGate   "the page is quiet": the new data is open AND no job runs AND the data key stays the same for a moment
//   createFrameGapMonitor  the longest gap between two XR frames (and the longest main-thread task) during a switch: the number to read on the device
// Memory rule of the order (a Quest 3 cannot hold two datasets: about 450 MiB of GPU and 650 MiB of CPU for one): the OLD data's GPU textures and CPU arrays
// are released BEFORE the page opens the new data, and the new data is never prepared while the old one is still referenced.

// how long the steps may wait before the switch gives up (a headset user must not stare at a board for minutes): the page's quiet time after the data is open (the data is then used
// as it is), and the page's own opening of the data (then the switch FAILS with a message; the same level can be tried again)
export const SETTLE_TIMEOUT_MS = 60000;
export const LOAD_TIMEOUT_MS = 180000;
// the read of the entries a switch started beside the page's load: a device whose IndexedDB stalls must not hold the switch (it then computes the data as it did before the entries existed)
export const CACHE_READ_TIMEOUT_MS = 120000;
// the promise, or a rejection after ms (the timer is always cleared)
export function withTimeout(promise, ms, what = 'step') {
  let t = 0;
  return Promise.race([Promise.resolve(promise), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' timed out (' + Math.round(ms / 1000) + ' s)')), ms); })]).finally(() => clearTimeout(t));
}

// the steps the loading board counts through (bind is instant, done ends it)
export const SWAP_STAGES = ['release', 'load', 'settle', 'prepare', 'compile', 'upload', 'refine'];

export function createSwapGuard() {
  let gen = 0;
  return { next: () => ++gen, get gen() { return gen; }, isCurrent: g => g === gen, cancel: () => { gen++; } };
}

// env (all injected by vr-view.js; every step may be async):
//   isCurrent(gen)            false once another switch / the session end overtook this one
//   stage(name, detail)       progress for the loading board ('release' 'load' 'settle' 'prepare' 'compile' 'upload' 'bind' 'refine' 'done')
//   hide()                    the volume is hidden, the session's data state (sections, points in view, ...) is cleared, the loading board is shown
//   releaseGpu() / releaseCpu()   the old data's GPU textures / CPU arrays are dropped (and the page-side VR caches)
//   load2d(setId)             opens the data on the page (the 2D side frees its old data itself), resolves when it is open
//   settle()                  resolves when the page is quiet (the bundled project applied, no job running)
//   prepare()                 -> P, the CPU data of the new data (workers + slices)
//   compile(P)                the shader programs the new data needs (async compile, hidden)
//   uploadCoarse(P)           -> assets: the 256 grid (and everything the picture needs) in the GPU
//   bind(P, assets)           the volume is shown with the coarse data, the session state is initialised for it
//   uploadFine(P, assets)     the 512 grid, in slices, then swapped in
//   discard(x)                a result that arrived for an overtaken switch is released
//   fail(e)                   an error ends the switch (the board says so)
// Returns {status: 'done' | 'cancelled' | 'failed'}. The stages never overlap and every await is followed by an isCurrent check.
export async function runDataSwap(env, setId, gen) {
  const cur = () => env.isCurrent(gen);
  let P = null, assets = null;
  try {
    env.stage('release'); env.hide(); env.releaseGpu(); env.releaseCpu();
    if (!cur()) return { status: 'cancelled' };
    env.stage('load', setId); await env.load2d(setId); if (!cur()) return { status: 'cancelled' };
    env.stage('settle'); await env.settle(); if (!cur()) return { status: 'cancelled' };
    env.stage('prepare'); P = await env.prepare(); if (!cur()) { env.discard(P); return { status: 'cancelled' }; }
    env.stage('compile'); await env.compile(P); if (!cur()) { env.discard(P); return { status: 'cancelled' }; }
    env.stage('upload'); assets = await env.uploadCoarse(P); if (!cur()) { env.discard(assets); env.discard(P); return { status: 'cancelled' }; }
    env.stage('bind'); env.bind(P, assets);
    env.stage('refine'); await env.uploadFine(P, assets); if (!cur()) return { status: 'cancelled' };
    env.stage('done');
    return { status: 'done' };
  } catch (e) {
    if (!cur()) { try { env.discard(assets); env.discard(P); } catch { /* none */ } return { status: 'cancelled' }; }
    try { env.fail(e); } catch { /* none */ }
    return { status: 'failed', error: e };
  }
}

// GPU uploads in slices. add({key, depth, bytesPerSlice}) queues a texture; tick() (once per frame, before the render) copies slabs of z slices through
// copy(job, z0, z1) until bytesPerTick or budgetMs is used up (always at least one slice per tick, so an upload always finishes). whenDone(key) resolves
// when the job has been copied completely (at once for an unknown key). clear() drops everything (the promises of dropped jobs resolve false).
// adaptive: the slab size follows what the copies cost on this device (a copy over 1.5 x budgetMs halves it, down to minBytes; copies under budgetMs / 3 grow it by half, up to
// maxBytes): a slow upload path (a busy GPU process, a slower device) gets smaller steps instead of one long frame.
export function createUploadQueue({ copy, now = () => performance.now(), bytesPerTick: bytesStart = 2 << 20, budgetMs = 2, adaptive = false, minBytes = 128 << 10, maxBytes = 4 << 20 }) {
  let bytesPerTick = bytesStart;
  const jobs = [], waiters = new Map(), doneKeys = new Set(), failed = new Map();
  // ok true = copied completely, false = dropped (clear), err = the copy threw (the waiters REJECT with it: the switch ends as failed instead of the render loop dying)
  const finish = (key, ok, err) => { if (ok) doneKeys.add(key); if (err) failed.set(key, err); const w = waiters.get(key); if (w) { waiters.delete(key); w.forEach(([res, rej]) => (err ? rej(err) : res(ok))); } };
  return {
    add(job) { jobs.push({ ...job, next: 0 }); doneKeys.delete(job.key); failed.delete(job.key); },
    tick() {
      if (!jobs.length) return 0;
      const t0 = now();
      let bytes = 0, n = 0;
      while (jobs.length) {
        const j = jobs[0], per = Math.max(1, j.bytesPerSlice | 0), left = Math.max(per, bytesPerTick - bytes), z0 = j.next, z1 = Math.min(j.depth, z0 + Math.max(1, Math.floor(left / per)));
        const tc = adaptive ? now() : 0;
        try { copy(j, z0, z1); } catch (e) { // a copy that throws (a lost context, a destroyed texture) must not reach the render loop: this job fails, the others are dropped, the waiters reject
          jobs.shift(); const rest = jobs.splice(0); finish(j.key, false, e); for (const r of rest) finish(r.key, false); return n; }
        j.next = z1; bytes += (z1 - z0) * per; n++;
        if (adaptive) { const dt = now() - tc; if (dt > budgetMs * 1.5) bytesPerTick = Math.max(minBytes, Math.floor(bytesPerTick / 2)); else if (dt < budgetMs / 3) bytesPerTick = Math.min(maxBytes, Math.floor(bytesPerTick * 1.5)); }
        if (j.next >= j.depth) { jobs.shift(); finish(j.key, true); }
        if (bytes >= bytesPerTick || now() - t0 >= budgetMs) break;
      }
      return n;
    },
    whenDone(key) {
      if (failed.has(key)) return Promise.reject(failed.get(key));
      if (doneKeys.has(key) || !jobs.some(j => j.key === key)) return Promise.resolve(doneKeys.has(key));
      return new Promise((res, rej) => { const w = waiters.get(key) || []; w.push([res, rej]); waiters.set(key, w); });
    },
    clear() { const ks = jobs.map(j => j.key); jobs.length = 0; for (const k of ks) finish(k, false); doneKeys.clear(); failed.clear(); },
    get pending() { return jobs.length; },
    get bytesPerTickNow() { return bytesPerTick; },
    get bytesLeft() { return jobs.reduce((a, j) => a + (j.depth - j.next) * j.bytesPerSlice, 0); },
  };
}

// The page is quiet when the new data is open (volumeReady), no progress job runs (busy), and key() has not changed for quietMs. check() is polled every pollMs
// by wait(); the wait gives up after timeoutMs (the data is then used as it is: a project that never settles must not hold the headset forever).
export function createSettleGate({ now = () => performance.now(), quietMs = 1200, pollMs = 200, timeoutMs = SETTLE_TIMEOUT_MS, volumeReady, busy, key, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let since = null, last = null;
  const check = () => {
    const ok = !!volumeReady() && !busy(), k = ok ? key() : null, t = now();
    if (!ok || k !== last) { last = k; since = ok ? t : null; return false; }
    if (since == null) since = t;
    return t - since >= quietMs;
  };
  return {
    check,
    reset() { since = null; last = null; },
    async wait(isCurrent = () => true) {
      const t0 = now();
      for (;;) {
        if (!isCurrent()) return false;
        if (check()) return true;
        if (now() - t0 >= timeoutMs) return false;
        await sleep(pollMs);
      }
    },
  };
}

// The gap between two XR frames (ms) and the longest main-thread task, per window (begin ... end) and for the whole session. tick(now) once per frame.
// A gap above frozenMs counts as a stall (a frame the headset did not get on time: at 72 Hz one frame is 13.9 ms). observe() starts a PerformanceObserver on
// 'longtask' (Chromium, so also the Quest browser; absent elsewhere: only the frame gaps are then known). summary() is the text for the device / the console.
export function createFrameGapMonitor({ frozenMs = 100, longTaskSource = null } = {}) {
  let last = null, win = null, all = { maxGap: 0, maxTask: 0, frames: 0, stalls: 0 }, obs = null;
  const newWin = label => ({ label, t0: last, maxGap: 0, maxTask: 0, frames: 0, stalls: 0, worstAt: 0 });
  const task = ms => { if (ms > all.maxTask) all.maxTask = ms; if (win && ms > win.maxTask) win.maxTask = ms; };
  return {
    tick(now) {
      if (last != null) {
        const g = now - last;
        all.frames++; if (g > all.maxGap) all.maxGap = g; if (g > frozenMs) all.stalls++;
        if (win) { win.frames++; if (g > win.maxGap) { win.maxGap = g; win.worstAt = now - (win.t0 ?? now); } if (g > frozenMs) win.stalls++; }
      }
      last = now;
    },
    begin(label) { win = newWin(label); return win; },
    end() { const w = win; win = null; return w ? { label: w.label, maxGapMs: Math.round(w.maxGap * 10) / 10, maxTaskMs: Math.round(w.maxTask * 10) / 10, frames: w.frames, stalls: w.stalls, worstAtMs: Math.round(w.worstAt) } : null; },
    get active() { return !!win; },
    get session() { return { maxGapMs: Math.round(all.maxGap * 10) / 10, maxTaskMs: Math.round(all.maxTask * 10) / 10, frames: all.frames, stalls: all.stalls }; },
    observe(PerfObs = globalThis.PerformanceObserver) {
      if (obs || !PerfObs) return false;
      try { obs = new PerfObs(list => { for (const e of list.getEntries()) task(e.duration); }); obs.observe({ type: 'longtask', buffered: false }); } catch { obs = null; return false; }
      return true;
    },
    stop() { try { obs?.disconnect(); } catch { /* none */ } obs = null; },
    noteTask: task,
    text(ja = true) {
      const s = all, w = win;
      return (ja ? '最長フレーム間隔 ' : 'longest frame gap ') + Math.round(w ? w.maxGap : s.maxGap) + ' ms' + (s.maxTask ? (ja ? ' · 最長タスク ' : ' · longest task ') + Math.round(w ? w.maxTask : s.maxTask) + ' ms' : '');
    },
  };
}

// How the new data is shown for the settings: the coarse grid first, then the fine one. grids: what the prepared data holds. wantFine = settings.data === 0 (512)
export function swapPlan({ hasHalf, dataSetting }) {
  return { coarse: hasHalf ? 'half' : 'full', fineNeeded: hasHalf, showFineWhenReady: hasHalf && (dataSetting | 0) === 0 };
}
