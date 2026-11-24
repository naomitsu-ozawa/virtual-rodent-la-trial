// Work that must not sit inside the XR frame callback (E1). Pure module: no imports, no DOM access of its own (the caller passes what it needs).
//
// What the source says (Chromium, read at tags 120 / 124 / 128 / 132 / 136 / 140 and main; the Quest browser's own build is NOT verified):
// - GPUQueue::submit() ends with FlushNow() (gpu_queue.cc, "Flush immediately so the GPU process eagerly processes commands"), so a queue.submit() leaves the page at once, wherever it sits in the callback.
//   The guess that the callback's submits are sent together when the callback returns is NOT supported for submit(); the calls that only EnsureFlush (writeBuffer, createX, onSubmittedWorkDone...) are
//   flushed from a microtask (dawn_control_client_holder.cc). So the length of the callback AFTER the volume submit does not delay the GPU's start; this module is about the callback's tail, not about the GPU.
// - XRSession::OnFrame (xr_session.cc) runs the callbacks (ExecuteCallbacks), then OnFrameEnd() and frameProvider()->SubmitFrame(). The HTML spec's "clean up after running script" runs a microtask checkpoint
//   when a callback returns (read from the spec; the V8 call path in Blink was not read), so a microtask queued in the callback would run BEFORE SubmitFrame and hold the frame; a posted task runs after it.
// So the work that feeds no pose and nothing of this frame's picture is posted as one task (MessageChannel: no timer clamp / throttling, and no idle-period dependence like requestIdleCallback, which needs the
// browser to see idle time between frames that an immersive session may never show; both unverified on the Quest). If the next frame's callback starts before that task has run, drain() runs the work there
// (counted in late), so the state a frame reads is never older than the frame before it.
//
// A job is made once (job(fn)); request(job, arg) marks it for the next run (a second request before the run replaces the argument: the work is the latest state's), nothing is allocated per frame.
// mode: 'task' (the default), 'micro' (queueMicrotask: after the callback, before the XR submit), 'off' (request() runs the job on the spot, the order of the code before E1).
export const POST_MODES = ['task', 'micro', 'off'];
// the mode from a URL query string (?vrpost=off|micro|task); anything else: 'task'
export function postFrameMode(search = '') {
  try { const m = /[?&]vrpost=([a-z]+)/.exec(String(search)); if (m && POST_MODES.includes(m[1])) return m[1]; } catch { /* default */ }
  return 'task';
}
export function createPostFrame({ mode = 'task', channel = null, micro = null, now = () => performance.now() } = {}) {
  const queue = []; let scheduled = false, ran = 0, late = 0, runs = 0, ms = 0, msMax = 0, wait = 0, qAt = 0, cbN = 0, cbMs = 0, cbMax = 0;
  const mk = channel || (() => {
    try { if (typeof MessageChannel === 'function') { const c = new MessageChannel(); let cb = null; c.port1.onmessage = () => cb?.(); return fn => { cb = fn; c.port2.postMessage(0); }; } } catch { /* none */ }
    return fn => setTimeout(fn, 0);
  })();
  const mq = micro || (typeof queueMicrotask === 'function' ? queueMicrotask : fn => Promise.resolve().then(fn));
  const flushQueue = () => {
    if (!queue.length) return;
    const t0 = now(); let n = 0;
    for (let i = 0; i < queue.length; i++) {
      const j = queue[i]; j.pending = false; const a = j.arg; j.arg = undefined; n++;
      try { j.fn(a); } catch (e) { console.warn('post-frame job:', e); }
    }
    queue.length = 0; ran += n; runs++; const d = now() - t0; ms += d; if (d > msMax) msMax = d;
  };
  const run = () => { scheduled = false; if (qAt > 0) { const w = now() - qAt; if (w > wait) wait = w; qAt = 0; } flushQueue(); };
  return {
    mode,
    // a job: fn(arg) runs after the frame callback; the handle goes to request()
    job: fn => ({ fn, arg: undefined, pending: false }),
    // mark the job for the next run (mode 'off': run it now)
    request(j, arg) {
      if (mode === 'off') { try { j.fn(arg); } catch (e) { console.warn('post-frame job:', e); } return; }
      j.arg = arg;
      if (!j.pending) { j.pending = true; queue.push(j); }
    },
    // the end of the frame callback (after the last submit): post the run when something is waiting
    schedule() {
      if (mode === 'off' || !queue.length || scheduled) return;
      scheduled = true; qAt = now();
      if (mode === 'micro') mq(run); else mk(run);
    },
    // the start of the next frame callback: work the task has not run yet runs now (late)
    drain() { if (!queue.length) return false; late++; flushQueue(); return true; },
    // the length of a whole frame callback (the caller's end-of-callback time minus its start): the record's header shows its mean / longest, the evidence of how much the posted work took out of it
    tail(d) { if (d >= 0 && d < 1000) { cbN++; cbMs += d; if (d > cbMax) cbMax = d; } },
    // a session's end: nothing may run later
    clear() { for (const j of queue) { j.pending = false; j.arg = undefined; } queue.length = 0; },
    pending: () => queue.length,
    // counters for the record: jobs run, task runs, runs the next frame had to do itself, total / longest run (ms), longest wait from the callback's end to the run (ms), callbacks seen by tail(): count, total, longest (ms)
    stats: () => ({ ran, runs, late, ms, msMax, wait, cbN, cbMs, cbMax }),
  };
}
// save-on-hidden: fn() runs when the page or the XR session is hidden (visibilitychange on the document and on the session, state 'hidden').
// Returns remove(): the listeners come off when the session ends (a stale one would overwrite a newer session's mirror).
export function flushOnHidden(fn, { doc = globalThis.document, session = null } = {}) {
  const on = () => { try { if (doc?.visibilityState === 'hidden' || session?.visibilityState === 'hidden') fn(); } catch { /* the save is best effort */ } };
  try { doc?.addEventListener?.('visibilitychange', on); } catch { /* none */ }
  try { session?.addEventListener?.('visibilitychange', on); } catch { /* none */ }
  return () => { try { doc?.removeEventListener?.('visibilitychange', on); } catch { /* gone */ } try { session?.removeEventListener?.('visibilitychange', on); } catch { /* gone */ } };
}
