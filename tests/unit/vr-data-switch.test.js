import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSwapGuard, runDataSwap, createUploadQueue, createSettleGate, createFrameGapMonitor, swapPlan, SWAP_STAGES, SETTLE_TIMEOUT_MS, LOAD_TIMEOUT_MS, withTimeout } from '../../docs/vr-data-switch.js';
import { frameOrTimer } from '../../docs/utils.js';
import { levelSwitchItems, simpleMenuLayout, SIMPLE_MENU, EVENT_LEVELS } from '../../docs/event-mode.js';

// switching the data inside a running VR session. The pieces (docs/vr-data-switch.js) are pure; vr-view.js (a WebXR file, not run in node) wires them, checked on its source.

// an env that records the order of every step; hooks: {name: fn} replace a step
function makeEnv(hooks = {}, current = () => true) {
  const log = [], env = {};
  const step = (name, ret) => (...a) => { log.push(name + (a.length && typeof a[0] === 'string' ? ':' + a[0] : '')); const h = hooks[name]; return h ? h(...a) : ret; };
  env.isCurrent = g => current(g);
  env.stage = step('stage', undefined);
  for (const n of ['hide', 'releaseGpu', 'releaseCpu', 'discard', 'fail']) env[n] = step(n, undefined);
  env.load2d = async (...a) => { log.push('load2d:' + a[0]); await (hooks.load2d?.(...a)); };
  env.settle = async () => { log.push('settle'); await hooks.settle?.(); };
  env.prepare = async () => { log.push('prepare'); await hooks.prepare?.(); return { P: 1 }; };
  env.compile = async P => { log.push('compile'); await hooks.compile?.(P); };
  env.uploadCoarse = async P => { log.push('uploadCoarse'); await hooks.uploadCoarse?.(P); return { A: 1 }; };
  env.bind = step('bind', undefined);
  env.uploadFine = async () => { log.push('uploadFine'); await hooks.uploadFine?.(); };
  return { env, log };
}
const steps = log => log.filter(l => !l.startsWith('stage'));

describe('runDataSwap: the order of a switch', () => {
  it('hide, free the old GPU data, free the old CPU data, THEN open the new data; prepare, compile, upload coarse, bind, upload fine', async () => {
    const { env, log } = makeEnv();
    const r = await runDataSwap(env, 'sample2', 1);
    expect(r).toEqual({ status: 'done' });
    expect(steps(log)).toEqual(['hide', 'releaseGpu', 'releaseCpu', 'load2d:sample2', 'settle', 'prepare', 'compile', 'uploadCoarse', 'bind', 'uploadFine']);
    // two datasets are never held at once: both releases come before the page opens the new one
    expect(log.indexOf('releaseGpu')).toBeLessThan(log.indexOf('load2d:sample2')); expect(log.indexOf('releaseCpu')).toBeLessThan(log.indexOf('load2d:sample2'));
    // the stages the loading board shows, in order (bind is instant, done ends the board)
    expect(log.filter(l => l.startsWith('stage')).map(l => l.slice(6).replace(/:.*/, ''))).toEqual(['release', 'load', 'settle', 'prepare', 'compile', 'upload', 'bind', 'refine', 'done']);
    for (const s of SWAP_STAGES) expect(['release', 'load', 'settle', 'prepare', 'compile', 'upload', 'refine']).toContain(s);
  });
  it('the shader programs are compiled before the data is shown, and the coarse data is up before it is bound', async () => {
    const { env, log } = makeEnv();
    await runDataSwap(env, 's', 1);
    expect(log.indexOf('compile')).toBeLessThan(log.indexOf('bind')); expect(log.indexOf('uploadCoarse')).toBeLessThan(log.indexOf('bind')); expect(log.indexOf('bind')).toBeLessThan(log.indexOf('uploadFine'));
  });
  it('a switch overtaken at any await drops its result: nothing after that step runs and the results are discarded', async () => {
    for (const at of ['load2d', 'settle', 'prepare', 'compile', 'uploadCoarse', 'uploadFine']) {
      let gen = 1;
      const { env, log } = makeEnv({ [at]: () => { gen = 2; } }, g => g === gen);
      const r = await runDataSwap(env, 's', 1);
      expect(r.status, at).toBe('cancelled');
      const i = steps(log).indexOf(at === 'load2d' ? 'load2d:s' : at);
      const after = steps(log).slice(i + 1).filter(l => l !== 'discard');
      expect(after, at).toEqual([]); // nothing else ran after the overtaken step (a late result is only discarded)
      if (['prepare', 'compile', 'uploadCoarse'].includes(at)) expect(log.includes('discard'), at).toBe(true);
      expect(log.includes('fail'), at).toBe(false);
    }
  });
  it('overtaken before the first await (the session ended while the old data was being released): cancelled, the new data is never opened', async () => {
    const { env, log } = makeEnv({ releaseCpu: () => {} }, () => false);
    expect((await runDataSwap(env, 's', 1)).status).toBe('cancelled'); expect(log.includes('load2d:s')).toBe(false);
  });
  it('an error ends the switch through fail(); an error of an overtaken switch is not reported', async () => {
    const e1 = new Error('boom'), seen = [];
    const a = makeEnv({ prepare: () => { throw e1; }, fail: e => seen.push(e) });
    expect(await runDataSwap(a.env, 's', 1)).toMatchObject({ status: 'failed', error: e1 }); expect(seen).toEqual([e1]);
    let gen = 1;
    const b = makeEnv({ prepare: () => { gen = 2; throw new Error('late'); }, fail: e => seen.push(e) }, g => g === gen);
    expect((await runDataSwap(b.env, 's', 1)).status).toBe('cancelled'); expect(seen).toHaveLength(1);
  });
});

describe('createSwapGuard (generation numbers)', () => {
  it('a newer switch (or cancel) makes the older one stale', () => {
    const g = createSwapGuard(), a = g.next();
    expect(g.isCurrent(a)).toBe(true);
    const b = g.next(); expect(g.isCurrent(a)).toBe(false); expect(g.isCurrent(b)).toBe(true);
    g.cancel(); expect(g.isCurrent(b)).toBe(false); expect(g.gen).toBe(3);
  });
});

describe('createUploadQueue (GPU uploads in slices)', () => {
  const mk = (opts = {}) => { const copies = [], q = createUploadQueue({ copy: (j, z0, z1) => copies.push([j.key, z0, z1]), now: opts.now, bytesPerTick: opts.bytes ?? 100, budgetMs: opts.ms ?? 1e9 }); return { q, copies }; };
  it('copies every slice exactly once, in order, a few per tick (bytesPerTick), and says so when a texture is complete', async () => {
    const { q, copies } = mk({ bytes: 100 });
    q.add({ key: 'a', depth: 10, bytesPerSlice: 30 }); q.add({ key: 'b', depth: 4, bytesPerSlice: 50 });
    let done = null; q.whenDone('a').then(v => { done = v; });
    expect(q.bytesLeft).toBe(10 * 30 + 4 * 50);
    let ticks = 0; while (q.pending && ticks < 100) { q.tick(); ticks++; }
    const got = (k) => copies.filter(c => c[0] === k).sort((x, y) => x[1] - y[1]);
    for (const [k, d] of [['a', 10], ['b', 4]]) { const c = got(k); expect(c[0][1]).toBe(0); expect(c.at(-1)[2]).toBe(d); for (let i = 1; i < c.length; i++) expect(c[i][1]).toBe(c[i - 1][2]); }
    // never much more than the budget per tick (the one slice that crosses it)
    expect(Math.max(...copies.map(c => (c[2] - c[1]) * (c[0] === 'a' ? 30 : 50)))).toBeLessThanOrEqual(100);
    await Promise.resolve(); expect(done).toBe(true); expect(q.pending).toBe(0); expect(q.bytesLeft).toBe(0);
    expect(q.tick()).toBe(0);
  });
  it('always moves at least one slice per tick (a slice bigger than the budget still goes up), and stops at the time budget', () => {
    const big = mk({ bytes: 10 }); big.q.add({ key: 'x', depth: 3, bytesPerSlice: 1000 }); big.q.tick(); expect(big.copies).toEqual([['x', 0, 1]]);
    let t = 0; const timed = mk({ bytes: 1e9, ms: 2, now: () => (t += 1.5) });
    for (let i = 0; i < 6; i++) timed.q.add({ key: 'j' + i, depth: 1, bytesPerSlice: 10 });
    timed.q.tick(); expect(timed.copies.length).toBe(2); expect(timed.q.pending).toBe(4); // the time budget ends the tick between two textures (a slab itself is bounded by bytesPerTick)
  });
  it('whenDone of an unknown / finished key resolves at once; clear() drops the jobs and resolves their waiters with false', async () => {
    const { q } = mk(); q.add({ key: 'k', depth: 2, bytesPerSlice: 1 });
    const w = q.whenDone('k'); q.clear(); expect(await w).toBe(false); expect(q.pending).toBe(0);
    expect(await q.whenDone('nothing')).toBe(false);
    q.add({ key: 'm', depth: 1, bytesPerSlice: 1 }); q.tick(); expect(await q.whenDone('m')).toBe(true);
  });
});

describe('createUploadQueue adaptive slabs', () => {
  it('a copy over 1.5 x budget halves the next slab (down to the minimum), cheap copies grow it by half (up to the maximum); not adaptive = fixed', () => {
    let t = 0, cost = 10; const sizes = [];
    const q = createUploadQueue({ copy: (j, z0, z1) => { sizes.push((z1 - z0) * j.bytesPerSlice); t += cost; }, now: () => t, bytesPerTick: 1000, budgetMs: 2, adaptive: true, minBytes: 100, maxBytes: 4000 });
    q.add({ key: 'a', depth: 1000, bytesPerSlice: 10 });
    for (let i = 0; i < 6; i++) q.tick(); // slow copies: 10 ms each against a 2 ms budget
    expect(sizes.slice(0, 6)).toEqual([1000, 500, 250, 120, 100, 100]); expect(q.bytesPerTickNow).toBe(100);
    cost = 0.1; for (let i = 0; i < 10; i++) q.tick(); // cheap copies: the slab grows again, never over the maximum
    expect(q.bytesPerTickNow).toBe(4000);
    // the same copies, not adaptive: always the start size
    t = 0; cost = 10; const fixed = []; const f = createUploadQueue({ copy: (j, z0, z1) => { fixed.push((z1 - z0) * 10); t += cost; }, now: () => t, bytesPerTick: 1000, budgetMs: 2 });
    f.add({ key: 'b', depth: 1000, bytesPerSlice: 10 }); for (let i = 0; i < 4; i++) f.tick(); expect(fixed).toEqual([1000, 1000, 1000, 1000]);
  });
});

describe('failures end the switch instead of hanging it or killing the render loop', () => {
  it('a copy that throws in tick() does not escape: that job fails, the others are dropped, the waiters reject, the queue stays usable', async () => {
    let n = 0; const q = createUploadQueue({ copy: (j, z0, z1) => { if (j.key === 'bad' && ++n === 2) throw new Error('boom'); }, bytesPerTick: 100 });
    q.add({ key: 'ok', depth: 2, bytesPerSlice: 100 }); q.add({ key: 'bad', depth: 10, bytesPerSlice: 100 }); q.add({ key: 'later', depth: 3, bytesPerSlice: 100 });
    const pOk = q.whenDone('ok'), pBad = q.whenDone('bad'), pLater = q.whenDone('later');
    const rej = pBad.then(() => 'resolved', e => e.message);
    for (let i = 0; i < 20; i++) expect(() => q.tick()).not.toThrow();
    expect(await pOk).toBe(true); expect(await rej).toBe('boom'); expect(await pLater).toBe(false);
    expect(q.pending).toBe(0);
    await expect(q.whenDone('bad')).rejects.toThrow('boom'); // asked after the failure: the same answer
    q.add({ key: 'bad', depth: 1, bytesPerSlice: 1 }); q.tick(); expect(await q.whenDone('bad')).toBe(true); // a new job under the key starts clean
  });
  it('an upload that throws makes runDataSwap fail (env.fail called once) and nothing after it runs', async () => {
    const { env, log } = makeEnv({ uploadCoarse: () => Promise.reject(new Error('copy failed')) });
    const r = await runDataSwap(env, 'sample2', 1);
    expect(r.status).toBe('failed'); expect(String(r.error.message)).toBe('copy failed');
    expect(log.filter(l => l === 'fail')).toHaveLength(1); expect(log).not.toContain('bind');
  });
  it('withTimeout: the promise wins when it is quick, a rejection after ms when it is not; the timer is cleared', async () => {
    expect(await withTimeout(Promise.resolve(5), 1000, 'x')).toBe(5);
    await expect(withTimeout(new Promise(() => {}), 20, 'opening the data')).rejects.toThrow(/opening the data timed out/);
    await expect(withTimeout(Promise.reject(new Error('inner')), 1000, 'x')).rejects.toThrow('inner');
  });
  it('frameOrTimer resolves although requestAnimationFrame never fires (a WebXR session), and at once when it does fire', async () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    try {
      globalThis.requestAnimationFrame = () => 0; const t0 = Date.now(); await frameOrTimer(15); expect(Date.now() - t0).toBeLessThan(1000);
      globalThis.requestAnimationFrame = cb => setTimeout(cb, 0); await frameOrTimer(5000);
      delete globalThis.requestAnimationFrame; await frameOrTimer(5); // no rAF at all
    } finally { if (had) Object.defineProperty(globalThis, 'requestAnimationFrame', had); else delete globalThis.requestAnimationFrame; }
  });
  it('the waits are bounded: the page may settle for 60 s at most, the page may take 3 minutes to open the data', () => {
    expect(SETTLE_TIMEOUT_MS).toBeLessThanOrEqual(60000); expect(SETTLE_TIMEOUT_MS).toBeGreaterThanOrEqual(30000); expect(LOAD_TIMEOUT_MS).toBeGreaterThan(SETTLE_TIMEOUT_MS);
    const g = createSettleGate({ volumeReady: () => true, busy: () => false, key: () => 'k' }); expect(typeof g.wait).toBe('function');
  });
  it('a load that never ends fails the switch (load2d wrapped in withTimeout) and releases nothing twice', async () => {
    const { env, log } = makeEnv({ load2d: () => withTimeout(new Promise(() => {}), 20, 'opening the data') });
    const r = await runDataSwap(env, 'sample2', 1);
    expect(r.status).toBe('failed'); expect(log).toContain('fail'); expect(log).not.toContain('prepare');
  });
});

describe('createSettleGate (the page is quiet)', () => {
  it('needs the data open, no job running, and the same data key for quietMs; any break starts the wait again', () => {
    let t = 0, ready = false, busy = false, key = 'a';
    const g = createSettleGate({ now: () => t, quietMs: 1000, volumeReady: () => ready, busy: () => busy, key: () => key });
    expect(g.check()).toBe(false); // not ready
    ready = true; t = 100; expect(g.check()).toBe(false); // first quiet sample
    t = 900; expect(g.check()).toBe(false);
    t = 1200; expect(g.check()).toBe(true);
    key = 'b'; t = 1300; expect(g.check()).toBe(false); // the data key changed (the project was applied): wait again
    t = 2400; expect(g.check()).toBe(true);
    busy = true; t = 2500; expect(g.check()).toBe(false); busy = false; t = 2600; expect(g.check()).toBe(false); t = 3700; expect(g.check()).toBe(true);
  });
  it('wait() polls until quiet, returns false when overtaken or timed out', async () => {
    let t = 0;
    const g = createSettleGate({ now: () => t, quietMs: 50, pollMs: 10, timeoutMs: 1000, volumeReady: () => true, busy: () => false, key: () => 'k', sleep: async ms => { t += ms; } });
    expect(await g.wait()).toBe(true);
    const g2 = createSettleGate({ now: () => t, quietMs: 50, pollMs: 10, timeoutMs: 100, volumeReady: () => false, busy: () => false, key: () => 'k', sleep: async ms => { t += ms; } });
    expect(await g2.wait()).toBe(false);
    expect(await g.wait(() => false)).toBe(false);
  });
});

describe('createFrameGapMonitor', () => {
  it('records the longest gap between XR frames per window and for the session, counts the stalls', () => {
    const m = createFrameGapMonitor({ frozenMs: 100 });
    [0, 14, 28, 42].forEach(t => m.tick(t));
    m.begin('switch'); [56, 70, 300, 314, 328].forEach(t => m.tick(t));
    const w = m.end();
    expect(w).toMatchObject({ label: 'switch', maxGapMs: 230, frames: 5, stalls: 1 });
    expect(m.active).toBe(false);
    [342, 356].forEach(t => m.tick(t)); expect(m.session).toMatchObject({ maxGapMs: 230, stalls: 1 });
    expect(m.end()).toBe(null);
    expect(m.text(true)).toContain('230 ms'); expect(m.text(false)).toContain('longest frame gap 230 ms');
  });
  it('long tasks (PerformanceObserver) are folded into the window and the session; no observer = frame gaps only', () => {
    const m = createFrameGapMonitor({ frozenMs: 100 });
    class Obs { constructor(cb) { Obs.cb = cb; } observe() {} disconnect() { Obs.gone = true; } }
    expect(m.observe(Obs)).toBe(true); expect(m.observe(Obs)).toBe(false);
    m.tick(0); m.begin('s'); m.tick(14); Obs.cb({ getEntries: () => [{ duration: 80 }, { duration: 120 }] }); m.tick(28);
    expect(m.end().maxTaskMs).toBe(120); expect(m.session.maxTaskMs).toBe(120);
    m.stop(); expect(Obs.gone).toBe(true);
    expect(createFrameGapMonitor().observe(null)).toBe(false);
  });
});

describe('swapPlan', () => {
  it('data with a 256 copy: the copy first, the fine grid after, shown at once only when the data setting says 512', () => {
    expect(swapPlan({ hasHalf: true, dataSetting: 1 })).toEqual({ coarse: 'half', fineNeeded: true, showFineWhenReady: false });
    expect(swapPlan({ hasHalf: true, dataSetting: 0 })).toEqual({ coarse: 'half', fineNeeded: true, showFineWhenReady: true });
    expect(swapPlan({ hasHalf: false, dataSetting: 1 })).toEqual({ coarse: 'full', fineNeeded: false, showFineWhenReady: false });
  });
});

describe('the data / level buttons (event-mode.js)', () => {
  const name = k => k;
  it('one per level, the open data lit, the armed one marked; labels carry the level number', () => {
    const items = levelSwitchItems(name, 'sample3', 'lv2');
    expect(items.map(i => i.id)).toEqual(EVENT_LEVELS.map(l => l.id));
    expect(items.find(i => i.sample === 'sample3')).toMatchObject({ on: true, armed: false });
    expect(items.find(i => i.id === 'lv2')).toMatchObject({ on: false, armed: true });
    expect(items[0].label).toBe('Lv0 evLv0Name');
    expect(levelSwitchItems(name, null).some(i => i.on || i.armed)).toBe(false);
  });
  it('the かんたん menu layout has the row above the bottom row only when asked, and the results list gives it the room', () => {
    const base = { segments: [], sectionOn: false, sliceOpacity: 0.6, trigger: { show: false }, results: Array.from({ length: 12 }, (_, i) => ({ hex: '#fff', name: 'r' + i, text: 'x' })), total: '1', text: new Proxy({}, { get: (_, k) => String(k) }) };
    const without = simpleMenuLayout(base);
    expect(without.some(w => w.id?.startsWith('level:'))).toBe(false);
    const levels = { items: levelSwitchItems(name, 'sample1', 'lv1'), busy: false, hint: 'hint', text: { title: 'データ', again: 'もう一度' } };
    const w = simpleMenuLayout({ ...base, levels });
    const btns = w.filter(x => x.id?.startsWith('level:'));
    expect(btns.map(b => b.id)).toEqual(EVENT_LEVELS.map(l => 'level:' + l.id));
    for (const b of btns) { expect(b.y).toBe(SIMPLE_MENU.LEVEL_Y); expect(b.y + b.h).toBeLessThanOrEqual(SIMPLE_MENU.BOTTOM); expect(b.disabled).toBe(false); }
    expect(btns.find(b => b.id === 'level:lv1').label).toBe('もう一度'); expect(btns.find(b => b.id === 'level:lv3').on).toBe(true);
    expect(w.some(x => x.id === 'levels:hint')).toBe(true);
    // the buttons are side by side inside the board and do not overlap
    for (let i = 1; i < btns.length; i++) expect(btns[i].x).toBeGreaterThanOrEqual(btns[i - 1].x + btns[i - 1].w);
    expect(btns.at(-1).x + btns.at(-1).w).toBeLessThanOrEqual(SIMPLE_MENU.W - SIMPLE_MENU.X + 1);
    // the results never run into the row
    const rows = w.filter(x => /^result:\d+:name$/.test(x.id || ''));
    expect(rows.length).toBeLessThan(without.filter(x => /^result:\d+:name$/.test(x.id || '')).length);
    for (const r of rows) expect(r.y).toBeLessThan(SIMPLE_MENU.LEVEL_Y);
    // busy: every level button is disabled (no second switch while one runs)
    expect(simpleMenuLayout({ ...base, levels: { ...levels, busy: true } }).filter(x => x.id?.startsWith('level:')).every(b => b.disabled)).toBe(true);
  });
});

// ---- vr-view.js wiring (a WebXR module, not run in node: its source is checked)
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const loopStart = src.indexOf('renderer.setAnimationLoop(xrTs=>{'), loopEnd = src.indexOf(' const cleanup=()=>{');
const loop = src.slice(loopStart, loopEnd);

describe('vr-view.js: the data of the session can be replaced (static wiring)', () => {
  it('runs the sequencer with the steps in the order that frees the old data first (the order itself is runDataSwap)', () => {
    expect(src).toContain('r=await runDataSwap(env,setId,gen)');
    expect(src).toContain('unbindData();loadBoard.mesh.visible=true;ownNote(\'unbind\',t)');
    expect(src).toContain('releaseSessionData();ownNote(\'release\',t)'); expect(src).toContain('releaseCpu:()=>releaseVrForSwap()');
    // the page opens the data by the practice-data route of the level cards (the 2D side frees its own old data there)
    expect(src).toContain("new CustomEvent('vrl-event-sample',{detail})");
    expect(src).toContain("await withTimeout(detail.done,LOAD_TIMEOUT_MS,'opening the data')");
    expect(src).toContain('chooseEventLevel(lv.id)');
    // compile before bind (a program set the data needs and the session lacks is compiled with the volume hidden)
    expect(src).toContain('compile:async Pn=>{const st=getSet(Pn);await compileSet(Pn,st)}');
  });
  it('review fixes: the shared warm-up uniforms let go of the first data, a failed switch can be retried, the reset button waits, the own data gets no switch buttons, a failure clears the flash', () => {
    const rel = src.slice(src.indexOf('const dropWarmRefs='), src.indexOf('const slicedTexture='));
    expect(rel).toContain('for(const m of gpuWarm)'); expect(rel).toContain('v.isTexture'); expect(rel).toContain('un.value=dummyEdit');
    expect(rel.indexOf('dropWarmRefs();')).toBeGreaterThan(rel.indexOf('gpu=null;')); // called from releaseSessionData
    expect(src).toContain('if(P.combo&&!(t.combo&&P.combo.mask===t.comboMask'); // the worker's combined bytes that prepareVrGpu did not use are dropped
    expect(src).toContain("fail:e=>{console.error('VR data switch failed',e);ui.swapFailed=true;ui.flash='';ui.flashUntil=0;");
    expect(src).toContain('ui.swapBusy=true;ui.swapFailed=false;');
    expect(src).toContain('const pressReset=()=>{\n  if(ui.swapBusy)return;');
    expect(src).toContain("const practiceOpen=()=>!!globalThis.__vrlOpenSample");
    expect(src).toContain('if(!practiceOpen()&&!ui.swapBusy)label(X,y0+150,L.dataOwn');
    expect(src).toContain('catch(e){if(running)throw e}'); // a compile that ends with the session is not an error
    expect(src).toContain('function abortVrPrepare(){'); expect(src).toContain("if(prep.disposed)throw new Error('VR preparation cancelled')");
  });
  it('no step of the switch path waits for the window rAF (it does not run while a WebXR session is presented): the 2D uploads use frameOrTimer', () => {
    const mv = readFileSync(new URL('../../docs/medical-volume.js', import.meta.url), 'utf8');
    expect(mv).not.toMatch(/await new Promise\(\s*requestAnimationFrame\s*\)/); expect(mv.match(/await frameOrTimer\(/g)?.length).toBe(2);
    for (const f of ['app.js', 'data-load.js', 'medical-volume.js', 'mpr-render.js', 'analysis-ops.js', 'utils.js']) { const t = readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8'); expect(t, f).not.toMatch(/await\s+new Promise\([^)]*requestAnimationFrame/); }
  });
  it('converts again when the page changed the data while it was converted (a bundled project finishing late), a bounded number of times', () => {
    const prep = src.slice(src.indexOf('prepare:async()=>{for(let again=0;;again++){'), src.indexOf('compile:async Pn=>{const st=getSet(Pn)'));
    expect(prep).toContain('const Pn=await env.prepareOnce()');
    expect(prep).toContain('Pn.key===now||again>=3||!live(gen)');
    expect(prep).toContain('gate.reset();await env.settle()');
    expect(prep).toContain('prepareOnce:()=>{let lastPhase');
  });
  it('releases the old data: the uniforms stop pointing at the textures first, then every GPU texture is disposed and every CPU reference dropped', () => {
    const rel = src.slice(src.indexOf('const releaseSessionData=()=>{'), src.indexOf('const slicedTexture='));
    expect(rel.indexOf("for(const k of ['vol','bricks','sliceVol','clsTex','cls4Tex','distTex','editTex','regionTex'])unifs[k].value=dummyEdit")).toBeGreaterThan(0);
    expect(rel.indexOf('volTex?.dispose()')).toBeGreaterThan(rel.indexOf('unifs[k].value=dummyEdit'));
    for (const s of ['uploadQueue.clear()', 'disposeExtra()', 'editTex?.dispose()', 'regionTex?.dispose()', 'comboTs.forEach(t=>{t.rb?.dispose();t.rb=null})', 'for(const t of swapMade)t.dispose()', 'P=null;vd=null;cbSliceIdx=null', 'gpu=null']) expect(rel, s).toContain(s);
    const unb = src.slice(src.indexOf('const unbindData=()=>{'), src.indexOf('const releaseSessionData=()=>{'));
    // no volume is drawn or picked meanwhile: the mesh leaves the holder, material / mesh are null (every use is guarded), the data references are cleared
    for (const s of ['meshObj.parent.remove(meshObj)', 'mesh=null;material=null', 'for(const pl of [...planes])removePlane(pl)', 'section.on=false', 'vrHalfExt=null;vrDims=null;vrFp=null;vrSpacing=null;volPick=null;regionList=[];histP=null', 'for(const [rid,lb] of pins)dropPin(rid,lb)', 'labelHist.reset()', 'cancelMeasure()', 'huLine.clear()']) expect(unb, s).toContain(s);
    expect(src).toContain('function releaseVrForSwap(){abortVrPrepare();prepareGen++;prepared=null;preparing=null;disposeGpuPrepared();hiddenMgr.release()}');
  });
  it('the textures of the new data are allocated without data and filled in slices; the frame loop runs the queue, never an await', () => {
    expect(src).toContain('tex.source.dataReady=false;tex.needsUpdate=true;renderer.initTexture(tex)');
    expect(src).toContain('createUploadQueue({adaptive:true,copy:');
    expect(src).toContain('renderer.copyTextureToTexture(j.src,j.tex,slabBox,slabAt)');
    expect(loop).toContain('uploadQueue.tick();');
    expect(loop.match(/uploadQueue\.tick\(\)/g)).toHaveLength(1);
    expect(loop).not.toMatch(/\bawait\b/);
    expect(loop).toContain('frameGaps.tick(performance.now());');
    // the 256 grid first, the fine grid in the background, the combined texture from the worker's bytes (never combined synchronously in a frame)
    expect(src).toContain("slicedTexture(key('combo'),pc.data,grid.dims,4,");
    expect(src).toContain("slicedTexture('fine',vdN.data,vdN.dims,2,");
    expect(src).toContain('const wantHalf=!!P.half&&(i===1||!fullReady)');
    expect(src).toContain('material.uniforms.sliceVol.value=fullReady&&full.v?full.v:t.v');
  });
  it('shader defines are NOT made unconditional: one program set per (analysis results present), compiled before it is shown; the variants of four stored segments too', () => {
    expect(src).toContain("const k=Pn.region?.data?'R':'-'");
    expect(src).toContain("makeVolumeBase(volumeDefines(k==='R'),unifs)");
    expect(src).toContain('const volumeDefines=region=>({...(VR_MEDIUMP?{VRL_MEDIUMP:\'\'}:{}),...(region?{VRL_REGIONS:\'\'}:{})});');
    expect(src).toContain('(P4(Pn)?[...VARIANT_KEYS,...VARIANT_KEYS4]:VARIANT_KEYS).filter(k=>!st.compiled.has(k))');
    expect(src).toContain('await compileVariantPrograms(renderer,keys.map(k=>st.variants[k]),keys.map(k=>st.rays[k]),[],()=>!!running)');
    // the other sets are compiled on the page (before the session) where compiling would block the main thread (no KHR_parallel_shader_compile); with it the session compiles on demand
    expect(src).toContain("const parallelCompile=r=>{try{return !!r.extensions.has('KHR_parallel_shader_compile')}catch{return false}};");
    expect(src).toContain('const shouldPrecompileSets=(r,settings)=>settings?.precompileSets!==false&&!parallelCompile(r);');
    const gpuFn = src.slice(src.indexOf('export async function prepareVrGpu('), src.indexOf('export function disposeGpuPrepared()'));
    expect(gpuFn).toContain('if(shouldPrecompileSets(renderer,settings)){'); expect(gpuFn).toContain('assets.compiledAll=true;');
    expect(gpuFn).toContain('const set=regions===own?vars:materialVariants(makeVolumeBase(volumeDefines(regions),u))');
    expect(src).toContain('compiled:new Set(allCompiled?[...VARIANT_KEYS,...VARIANT_KEYS4]:[])');
    expect(src).toContain('gpuWarm=gpu?[...gpu.warm,...(gpu.warmMore||[])]:[]'); expect(src).toContain('(g.warmMore||[]).forEach(m=>m.dispose())');
    // prepareVrGpu compiles through the same helper
    expect(src).toContain('const mats=await compileVariantPrograms(renderer,keys.map(k=>vars[k]),keys.map(k=>rayMaterialOf(vars[k])),');
  });
  it('the new data is bound by install(): state that follows the data, uniforms, the mesh back in the holder, the start place (正面 / 倍率) by placePending', () => {
    const ins = src.slice(src.indexOf('const install=(Pn,assets,first)=>{'), src.indexOf('const unbindData=()=>{'));
    for (const s of ['histP=P;histFor=null;histRun()', 'vrFp=activeSeries?datasetFingerprint(activeSeries):null', "evLabels=TRIGGER_AT_START==='label';initialVrModes()", 'cbScan=createSegScan();cbSliceIdx=sliceIndex(vd)',
      'u.halfExt.value.set(...vd.halfExt);u.calib.value.set(...vd.calibration)', 'compMaterial.uniforms.halfExt.value.set(...vd.halfExt)', 'holder.add(mesh);baseStep=vd.step;applyQuality();placePending=true']) expect(ins, s).toContain(s);
    // placePending -> bringVolumeFront: Lv0 starts at x4, every other data at x1 (vr-real-scale.js)
    expect(src).toContain('globalThis.__vrlOpenSample===TUT_SAMPLE?lv0HolderScale(realLongMm(),baseScale):startHolderScale(realLongMm(),baseScale)');
    const rs = src.slice(src.indexOf('const resetForNewData=()=>{'), src.indexOf('const refreshEvBoard'));
    for (const s of ['resetEventViewSettings(settings);saveSettings(settings)', 'for(const k of Object.keys(segMode))delete segMode[k]', 'vrWindow.c=+wc.value||0', 'ui.tab=10']) expect(rs, s).toContain(s);
    expect(src).toContain('resetForNewData();\n     {const t=performance.now();install(Pn,assets,false);ownNote(\'install\',t)}');
  });
  it('the data / level buttons: arm, then switch; none while a switch runs; the same data does nothing; the menus have the row / the tab', () => {
    const sp = src.slice(src.indexOf('const swapPress=setId=>{'), src.indexOf('const swapPress=setId=>{') + 420);
    expect(sp).toContain('if(ui.swapBusy||!setId)return;'); expect(sp).toContain('setId===globalThis.__vrlOpenSample&&!(ui.swapFailed||!P||!mesh)');
    expect(sp).toContain('resetPress(swapArmedId()===setId?ui.swapArm.until:0,performance.now())');
    expect(sp).toContain('if(r.fire){ui.swapArm=null;void swapData(setId)}');
    expect(src).toContain('if(!running||ui.swapBusy)return false;');
    expect(src).toContain("acts['level:'+l.id]=()=>swapPress(l.sample)");
    expect(src).toContain('levels:eventModeOn()&&practiceOpen()?{items:levelSwitchItems(tr,globalThis.__vrlOpenSample');
    expect(src).toContain('}else if(ui.tab===11){');
    expect(src).toContain("tabs:['表示','断面','スライス','画質','詳細','解析','位置','HU線','データ']");
  });
  it('the session end cancels a running switch, empties the queue, and disposes what the switch made (the program sets too)', () => {
    const c = src.slice(src.indexOf(' const cleanup=()=>{'), src.indexOf(" session.addEventListener('end',()=>{emit('session-end')"));
    for (const s of ['swapGuard.cancel();abortVrPrepare();uploadQueue.clear();frameGaps.stop()', 'for(const t of swapMade)t.dispose()', 'loadBoard.dispose()', 'for(const st of msets.values())', 'gpuWarm.forEach(m=>m.dispose())']) expect(c, s).toContain(s);
  });
  it('the measured result: the longest frame gap of the switch is in the console, the 詳細 tab and the page (window.__vrSwapReports)', () => {
    expect(src).toContain("console.log('[VR data switch]',JSON.stringify(res));(globalThis.__vrSwapReports||=[]).push(res);");
    expect(src).toContain('[ui.swapLine,22,\'#ffd27a\']');
    expect(src).toContain("frameGaps.begin('switch '+setId);frameGaps.observe();");
    // what the device log must tell: whether the browser compiles in parallel and whether the worker ran (a worker that could not start falls back to this thread silently otherwise)
    expect(src).toContain('parallelCompile:pcomp'); expect(src).toContain('worker:prepInfo?prepInfo.worker:null');
    expect(src).toContain('prepInfo:{worker:prep.stats.worker>0&&prep.stats.local===0,jobs:prep.stats}');
  });
  it('the prepared data is built in the worker and the slices are read with a yield every few ms inside a session', () => {
    const p = src.slice(src.indexOf('export async function prepareVrData('), src.indexOf('// classification bytes for the 3D position-comment markers'));
    for (const s of ['createVolumePrep()', 'prep.volume({', 'prep.cls({', 'noBricks:true,sliceMs', 'finally{prep.dispose();if(activePrep===prep)activePrep=null}']) expect(p, s).toContain(s);
    expect(p).not.toContain('buildDistanceBytes(');
    // the processing mask and the analysis index are made in the worker too (they were 0.2-0.6 s of main thread each): the page only collects the runs
    expect(p).toContain('editDescs:ed?ed.descs:[]'); expect(p).toContain('regionItems:ed?regionItemsOf():[]');
    expect(p).not.toContain('buildEditMask('); expect(p).not.toContain('buildRegionIndex(');
    expect(src).toContain('function buildEditMask(dims){const e=editDescsOf();return e?buildEditMaskOf(e.descs,e.sourceDims,dims):{activeMask:0,data:null}}'); // the 3D markers' hidden test keeps the synchronous call
    expect(src).toContain('const yieldMain=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0));');
    expect(src).toContain('sliceMs>0?performance.now()-sliceAt>=sliceMs||z===td-1:(z&15)===15||z===td-1');
  });
});
