// The compile gate of the WebGPU view: how the programs of a data set are handed to the GPU while frames are being drawn.
// Making a program is a createShaderModule (a WGSL text of tens of KB goes to the GPU process, which parses it) and a createRenderPipelineAsync / createComputePipelineAsync. Handed over all at once (167 programs in one task for a data set
// with results, child segments and parts) the GPU process may be busy with the texts for seconds and the frames' own commands wait behind them (an assumption: the device record of shows two stretches of 3.8 s and 4.1 s without a
// frame while 167 programs were being made; the cause was not confirmed on the device). So the programs go through this gate:
//   - a job (a function that starts one program, or one group of programs) runs in a task of its own, and the gate gives the main thread back (a timer task) after every job, so a frame callback can run between two jobs;
//   - at most `limit` programs are being compiled at once: the next job starts when one of those is done (inflight() = what the sources report + the promises tracked here);
//   - the order is first in, first out; a job queued with front: true goes before the waiting ones (a program a frame needs now).
// Nothing here uses requestAnimationFrame / requestIdleCallback: the page's own callbacks are held back while an immersive session is presented (the headset's frames come from session.requestAnimationFrame); timers run.
export const GATE = { limit: 3, pollMs: 6, bgDelayMs: 5000 }; // limit: programs compiling at once; pollMs: how often a job waiting for room looks again; bgDelayMs: how long after a call the programs nobody waits for (the other fourth-segment variant) are queued

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const yieldTask = () => sleep(0); // the main thread goes back to the page (a frame callback, a message runs) and the work goes on in the next task

export function createCompileGate({ limit = GATE.limit, pollMs = GATE.pollMs } = {}) {
  const jobs = []; // { run, front, resolve, reject, label }
  const sources = new Set(); // functions that return how many programs are compiling (the display's instance counts its own)
  let own = 0, pumping = false, started = 0, total = 0, maxInflight = 0, tasks = 0;
  const inflight = () => { let n = own; for (const s of sources) { try { n += s() | 0; } catch { /* a source that is gone counts nothing */ } } return n; };
  const pump = async () => {
    if (pumping) return; pumping = true;
    try {
      while (jobs.length) {
        let waited = 0;
        while (jobs.length && inflight() >= limit) { await sleep(pollMs); waited += pollMs; } // room first: the programs in flight finish while the frames go on
        if (!jobs.length) break;
        const j = jobs.shift(); started++;
        tasks++; if (globalThis.__gateTrace) globalThis.__gateTrace.push([performance.now(), j.label]); // (a measurement's own list: tools/wgpu-load-check.mjs)
        try {
          const r = j.run();
          if (r && typeof r.then === 'function') { own++; maxInflight = Math.max(maxInflight, inflight()); r.then(v => { own--; j.resolve(v); }, e => { own--; j.reject(e); }); } else { maxInflight = Math.max(maxInflight, inflight()); j.resolve(r); }
        } catch (e) { j.reject(e); }
        await sleep(0); // the main thread goes back to the page (a frame callback, a message) before the next job
      }
    } finally { pumping = false; if (jobs.length) pump(); }
  };
  return {
    // queue a job; the promise resolves (with the job's value) when the job's own promise (if it returned one) has settled, or when a plain job has run
    queue(run, { front = false, label = '' } = {}) {
      if (!jobs.length && !pumping && !inflight()) { started = 0; total = 0; } // a new batch: the progress starts over
      total++;
      const p = new Promise((resolve, reject) => { const j = { run, front, resolve, reject, label }; if (front) jobs.unshift(j); else jobs.push(j); });
      pump(); return p;
    },
    // the jobs that wait are dropped (their promises resolve with nothing: the device they were for is going away)
    clear() { for (const j of jobs.splice(0)) j.resolve(); },
    // count programs the gate does not start itself (a source returns the number now compiling)
    addSource(fn) { sources.add(fn); return () => sources.delete(fn); },
    inflight,
    get queued() { return jobs.length; },
    get busy() { return jobs.length > 0 || pumping || inflight() > 0; },
    // done / total of the batch that is running (started jobs less the programs still compiling)
    progress() { const t = Math.max(total, 1), done = Math.max(0, Math.min(total, started - Math.min(inflight(), started))); return { done: total ? done : 1, total: total || 1, fraction: total ? done / t : 1 }; },
    stats: () => ({ limit, started, total, maxInflight, tasks, queued: jobs.length }),
    limit,
  };
}
