import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRing, createPartLog, formatRow, formatEvent, formatHeader, partLogFileName, PART_LOG_MAX_ROWS, PART_LOG_MAX_EVENTS, PART_LOG_KEEP_EVENTS, PART_LOG_KEY } from '../../docs/vr-part-log.js';

describe('vr-part-log.js: the ring buffer', () => {
  it('keeps the newest entries, oldest first, and counts what was pushed', () => {
    const r = createRing(3);
    for (let i = 1; i <= 5; i++) r.push(i);
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.length).toBe(3);
    expect(r.total).toBe(5);
  });
  it('keepHead pins the first entries; only the ones after them are dropped', () => {
    const r = createRing(5, 2);
    for (let i = 1; i <= 4; i++) r.push(i);
    expect(r.toArray()).toEqual([1, 2, 3, 4]);
    for (let i = 5; i <= 9; i++) r.push(i);
    expect(r.toArray()).toEqual([1, 2, 7, 8, 9]);
    expect(r.length).toBe(5); expect(r.total).toBe(9);
    r.clear(); expect(r.toArray()).toEqual([]); r.push(1); expect(r.toArray()).toEqual([1]);
  });
  it('is empty at first and after clear', () => {
    const r = createRing(2);
    expect(r.toArray()).toEqual([]);
    r.push(1); r.clear();
    expect(r.toArray()).toEqual([]); expect(r.total).toBe(0);
  });
});

describe('vr-part-log.js: the lines', () => {
  const row = { fps: 71.6, vol: '3.1', main: '2.0', js: '–', eff: 0.85, per: 0.6, data: 256, step: 2, timer: true, menu: false,
    parts: [{ id: 1, n: true, s: 'done' }, { id: 2, n: false, s: 'making' }], bodyBound: true, bodyReady: false, bytes: 123456.4 };
  it('a row has every number the diagnosis needs, on one line', () => {
    const s = formatRow(12400, row);
    expect(s).toBe('S 12.4s fps=72 vol=3.1 main=2.0 js=- eff=0.85 per=0.60 data=256 step=2 gpuTimer=1 menu=0 parts=2 [u1:N/done u2:P/making] bodyBound=1 bodyReady=0 partBytes=123456');
    expect(s).not.toContain('\n');
  });
  it('a row with no part and no numbers still formats', () => {
    expect(formatRow(0, {})).toBe('S 0.0s fps=- vol=- main=- js=- eff=- per=- data=- step=- gpuTimer=0 menu=0 parts=0 [] bodyBound=0 bodyReady=0 partBytes=0');
    expect(() => formatRow(undefined, null)).not.toThrow();
  });
  it('an event has the elapsed milliseconds, a name and a one-line detail of bounded length', () => {
    expect(formatEvent(12345.6, 'pbStart', 'u1 bytes=5')).toBe('E   12346ms pbStart u1 bytes=5');
    expect(formatEvent(5, 'x')).toBe('E       5ms x');
    expect(formatEvent(1, 'x', 'a\nb\r\nc')).toBe('E       1ms x a b c');
    expect(formatEvent(1, 'x', 'z'.repeat(1000)).length).toBeLessThan(260);
  });
  it('the file name is vrl-vr-part-log-<build>-<YYYYMMDD>-<HHMM>.txt in local time', () => {
    expect(partLogFileName('768', new Date(2026, 10, 26, 9, 5, 59))).toBe('vrl-vr-part-log-768-20261126-0905.txt');
    expect(partLogFileName('7/6 8', new Date(2026, 0, 2, 23, 59))).toBe('vrl-vr-part-log-768-20260102-2359.txt');
    expect(partLogFileName(undefined, new Date(2026, 0, 2, 0, 0))).toBe('vrl-vr-part-log-x-20260102-0000.txt');
  });
  it('the header names the build, the start, the user agent and the size of the data', () => {
    const h = formatHeader({ build: '768', startedAt: new Date(2026, 10, 26, 9, 5, 7).getTime(), ua: 'Quest UA', mode: 'vr', dims: '256x256x512' }, { rows: 3, events: 2, rowsDropped: 1, eventsDropped: 0 });
    expect(h).toContain('# build: 768');
    expect(h).toContain('# started: 2026-11-26 09:05:07');
    expect(h).toContain('# userAgent: Quest UA');
    expect(h).toContain('# data: 256x256x512');
    expect(h).toContain('# rows: 3 (oldest 1 dropped) / events: 2');
  });
  it('the header shows what the session started with (prep), and nothing when it is not known', () => {
    const h = formatHeader({ build: '769', prep: { gpu: false, gpuKey: false, allCompiled: false, set: 'R', compiled: [] } }, {});
    expect(h).toContain('# prep: gpu=0 gpuKey=0 allCompiled=0 set=R compiled=0 []');
    expect(formatHeader({ prep: { gpu: true, gpuKey: true, allCompiled: false, set: 'RC', compiled: ['full', 'noEvents'] } }, {})).toContain('# prep: gpu=1 gpuKey=1 allCompiled=0 set=RC compiled=2 [full noEvents]');
    expect(formatHeader({ build: '769' }, {})).not.toContain('# prep');
  });
});

describe('vr-part-log.js: the log', () => {
  it('keeps at most 600 rows; events: a 770-sized session is whole, and past 5000 the first 300 stay', () => {
    expect(PART_LOG_MAX_ROWS).toBe(600); expect(PART_LOG_MAX_EVENTS).toBe(5000); expect(PART_LOG_KEEP_EVENTS).toBe(300);
    const small = createPartLog();
    for (let i = 0; i < 640; i++) small.event(i, 'e', 'n=' + i);
    expect(small.stats().eventsDropped).toBe(0);
    expect(small.text()).not.toContain('dropped');
    const log = createPartLog();
    for (let i = 0; i < 700; i++) log.row(i * 1000, { fps: 72 });
    for (let i = 0; i < 5400; i++) log.event(i, 'e', 'n=' + i);
    expect(log.stats()).toEqual({ rows: 600, events: 5000, rowsDropped: 100, eventsDropped: 400 });
    const t = log.text();
    expect(t.split('\n').filter(l => l.startsWith('S ')).length).toBe(600);
    expect(t.split('\n').filter(l => l.startsWith('E ')).length).toBe(5000);
    expect(t).toContain('S 699.0s'); expect(t).not.toContain('S 99.0s');
    expect(t).toContain('n=5399'); expect(t).toContain('n=0\n'); expect(t).toContain('n=299\n'); expect(t).not.toContain('n=300\n'); expect(t).not.toContain('n=699\n'); expect(t).toContain('n=700\n');
    expect(t).toContain('(400 dropped after the first 300)');
  });
  it('rows and events are merged by time; the header comes first', () => {
    const log = createPartLog();
    log.setMeta({ build: '768', ua: 'UA', dims: '1x2x3' });
    log.row(2000, { fps: 72 }); log.event(1500, 'cutStart', 'partDetach'); log.row(1000, { fps: 71 }); log.event(2000, 'shown');
    const lines = log.text().trim().split('\n');
    expect(lines[0]).toBe('# VRL VR part log');
    const body = lines.filter(l => !l.startsWith('#'));
    expect(body.map(l => l.replace(/^(S|E)\s+(\d+(?:\.\d)?).*$/, '$1$2'))).toEqual(['S1.0', 'E1500', 'E2000', 'S2.0']);
  });
  it('is empty until a row is added; clear empties it', () => {
    const log = createPartLog();
    expect(log.hasRows()).toBe(false);
    log.row(0, {}); expect(log.hasRows()).toBe(true);
    log.clear(); expect(log.hasRows()).toBe(false);
  });
  it('never throws on odd input', () => {
    const log = createPartLog();
    expect(() => { log.row(NaN, { parts: [null, undefined, {}] }); log.event(undefined, undefined, { toString() { throw new Error('x'); } }); log.setMeta(null); log.text(); }).not.toThrow();
  });
  it('the storage key is the one the page writes', () => { expect(PART_LOG_KEY).toBe('vrl-vr-part-log'); });
});

describe('vr-view.js: the wiring of the part log (a WebXR file: checked on its source)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const sec = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  it('the panel after the session has 保存 / 閉じる (Save / Close) only: no copy button, no log text on the page', () => {
    const p = sec('function showPartLogPanel(ja){', '// ---- preparation before the session');
    expect(p).toContain("ja?'保存':'Save'"); expect(p).toContain("ja?'閉じる':'Close'");
    expect(p.match(/createElement\('button'\)/g)).toHaveLength(2);
    expect(p).not.toMatch(/clipboard|Copy|コピー|<pre|createElement\('pre'\)|innerHTML/);
    expect(p).toContain('partLogFileName(APP_BUILD,new Date())');
    expect(p).toContain('URL.createObjectURL(new Blob([log.text()]');
    expect(p).toContain('a.download=');
  });
  it('the panel is offered at the end of the session beside the other panels; the text is copied to localStorage in a try', () => {
    expect(src).toContain('partLogFinish();showShotsPanel(ja);showBenchPanel(ja);showPartLogPanel(ja);');
    expect(src).toContain('const partLogFinish=()=>{try{lastPartLog=partLog;localStorage.setItem(PART_LOG_KEY,partLog.text())}catch{}};');
    expect(src).toContain("from './vr-part-log.js?v=");
  });
  it('a row is added once a second (a string only: no pixel read in the log code) and never throws', () => {
    const loop = sec('renderer.setAnimationLoop(xrTs=>{', ' const cleanup=()=>{');
    const second = loop.slice(loop.indexOf('if(now-fpsAt>=1000){'));
    expect(second).toContain('partLogRow({fps,vol:avg(\'vol\')');
    expect(second.indexOf('partLogRow(')).toBeLessThan(second.indexOf('for(const k in sums)'));
    const helpers = sec(' const partLog=createPartLog()', ' // requestSession must run inside the click');
    expect(helpers).not.toMatch(/readRenderTargetPixels|getBufferSubData|finish\(|getError/);
    expect(helpers).toContain('try{partLog.event(');
    expect(helpers).toContain('try{const g=half||vd');
  });
  it('the part block reports the row\'s part state and the events of the cut and of both bakes', () => {
    const snap = sec('partLogSnap=()=>{', '// the tables (called from refreshRegionLut');
    expect(snap).toContain('nOk&&q.nmats&&pbBoundOf(q)'); // the draw as partRender chooses it (the held bake of the set before counts: (a))
    for (const s of ["'done'", "'making'", "'skip'", "'idle'", 'bodyBound', 'bodyReady', 'bytes']) expect(snap).toContain(s);
    expect(snap).not.toMatch(/readRenderTargetPixels/);
    for (const ev of ["'cutStart'", "'shown'", "'cutFail'", "'attach'", "'partApply'", "'partApplyEnd'", "'bakeSet'", "'bakeStart'", "'bakeSkip'", "'pbStart'", "'pbDone'", "'pbDrop'", "'pbSkip'", "'texExc'"]) expect(src, ev).toContain('partLogEv(' + ev);
  });
  it('the ordinary programs of a baked part are compiled once when the body set lacks them, and the log says so', () => {
    const f = sec('const nEnsure=', 'const pbBind=');
    expect(f).toContain('compileVariantPrograms(renderer,[vm],[rm],[],alive)');
    expect(f).toContain('st.compiled.add(kn)');
    expect(f).toContain('nCompiling.has(id)');
    for (const d of ["'start k='", "'done ms='", "'fail "]) expect(f).toContain("partLogEv('nCompile'," + d);
    expect(sec('const pbBind=', 'const pbFrame=')).toContain('nEnsure(q);');
    expect(sec('partRender=low=>{', 'partLogSnap=()=>{')).toContain('if(!nOk&&q.nmats&&pbBoundOf(q))nEnsure(q);');
    expect(src).toContain('partLog.setMeta({prep:{gpu:!!gpu,');
  });
  it('a rebuild that only changes the hidden state does not drop the parts\' own bakes (the body\'s bake keeps its own rule)', () => {
    expect(sec('const pbOk=', 'const pbStart=')).toContain('(!t.rb?.busy||t.rb.hideOnly)');
    expect(sec('const pbOk=', 'const pbStart=')).toContain('(t.rb?.hideOnly?t.rb.skipContent===comboMask:t.comboMask===comboMask)');
    const fr = sec('const pbFrame=', 'partBakeFrame=()=>');
    expect(fr).toContain('cm=t?.rb?.hideOnly?t.rb.skipContent:t?.comboMask');
    expect(fr).toContain("cm!==x.mask?'mask-changed'");
    expect(fr).toContain('if(!ok||bakeApplying>0||t.rb?.busy)return;');
    expect(sec('const bodyBakeFrame=', 'const pbOk=')).not.toContain('hideOnly');
  });
  it('every place that gives up a part\'s own bake says why, with a short code', () => {
    const f = sec('const pbStart=', 'const pbBind=');
    expect(f.match(/q\.pbSkip=/g)).toHaveLength(3);
    expect(f.match(/partLogEv\('pbSkip'/g)).toHaveLength(3);
    for (const code of ['no-box-slot', 'no-ch4', 'tex-exc', 'worker-fail']) expect(f).toContain(code);
  });
  it('the cut\'s wait is measured from the start of partDetach to the moment the part is shown', () => {
    const d = sec('const partDetach=async tg=>{', 'const partHold=');
    expect(d.indexOf("partLogEv('cutStart'")).toBeLessThan(d.indexOf("partLogEv('shown'"));
    expect(d).toContain('performance.now()-cutInfo.t0');
  });
});
