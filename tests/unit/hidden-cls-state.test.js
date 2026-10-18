import { describe, it, expect } from 'vitest';
import { createHiddenClsManager } from '../../docs/hidden-cls-state.js';

// state handling of the classification bytes of the 3D point markers: fake clock + timers, synthetic builders (no data at all)
function rig(over = {}) {
  let t = 0, seg = 'a', vol = 'v1'; const timers = []; let loads = 0, builds = 0, ready = 0, failLoad = 0, failBuild = 0, permanent = false;
  const api = createHiddenClsManager({
    volumeKey: () => vol, segKey: () => vol + '|' + seg,
    loadVolume: async () => { loads++; if (failLoad > 0) { failLoad--; const e = new Error('boom'); e.permanent = permanent; throw e } return { n: loads } },
    buildCls: v => { builds++; if (failBuild > 0) { failBuild--; throw new Error('build') } return { cls: { tag: seg + v.n }, dims: [2, 2, 2], halfExt: [1, 1, 1] } },
    now: () => t, setTimer: (f, ms) => { const x = { f, at: t + ms }; timers.push(x); return x }, clearTimer: x => { if (x) x.dead = true },
    ...over,
  });
  const onReady = () => { ready++ };
  const advance = async ms => { t += ms; for (const x of timers.filter(x => !x.dead && x.at <= t)) { x.dead = true; x.f() } for (let i = 0; i < 10; i++) await Promise.resolve() };
  return { api, onReady, advance, set: { seg: s => { seg = s }, vol: s => { vol = s }, failLoad: n => { failLoad = n }, failBuild: n => { failBuild = n }, permanent: p => { permanent = p } }, count: () => ({ loads, builds, ready }) };
}

describe('hiddenClsManager', () => {
  it('waits for the key to be stable (250 ms), then builds once and reports ready', async () => {
    const r = rig();
    expect(r.api.get(r.onReady)).toBeNull();
    await r.advance(100); expect(r.count().loads).toBe(0);
    r.api.get(r.onReady); await r.advance(150);
    expect(r.count().ready).toBe(1); // the debounce timer asked for another look (a render), no build yet
    expect(r.count().builds).toBe(0);
    r.api.get(r.onReady); await r.advance(0);
    expect(r.count()).toMatchObject({ loads: 1, builds: 1 });
    expect(r.api.get(r.onReady).cls.tag).toBe('a1');
  });
  it('rapid key changes run only one build (the last key), never several in parallel', async () => {
    const r = rig();
    for (let i = 0; i < 20; i++) { r.set.seg('s' + i); r.api.get(r.onReady); await r.advance(20) }
    expect(r.count().builds).toBe(0); // the key never stood still for 250 ms
    await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    expect(r.count().builds).toBe(1);
    expect(r.api.get(r.onReady).cls.tag).toBe('s191');
  });
  it('a key change while building drops that build; the next one starts after the debounce', async () => {
    const r = rig(); r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady);
    r.set.seg('b'); // changes while the load is pending
    await r.advance(0);
    expect(r.count().builds).toBe(0);
    r.api.get(r.onReady); // the next frame sees the new key
    await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    expect(r.count().builds).toBe(1); expect(r.api.get(r.onReady).cls.tag).toBe('b1');
  });
  it('the volume is kept: a segment-only change builds the bytes again without loading the volume again', async () => {
    const r = rig(); r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    r.set.seg('b'); r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    expect(r.count()).toMatchObject({ loads: 1, builds: 2 });
    r.set.vol('v2'); r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    expect(r.count().loads).toBe(2); // another series / filter: loaded again
  });
  it('the previous result is kept while rebuilding (no flicker)', async () => {
    const r = rig(); r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    r.set.seg('b');
    expect(r.api.get(r.onReady).cls.tag).toBe('a1'); // key changed, not yet rebuilt: the old one
    await r.advance(300); expect(r.api.get(r.onReady).cls.tag).toBe('a1');
    await r.advance(0); expect(r.api.get(r.onReady).cls.tag).toBe('b1');
  });
  it('a failure is not cached: it is retried after 5 s', async () => {
    const r = rig(); r.set.failLoad(1);
    r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    expect(r.count().loads).toBe(1); expect(r.api.get(r.onReady)).toBeNull(); expect(r.api.state().failed).toBe(true);
    await r.advance(2000); r.api.get(r.onReady); await r.advance(0); expect(r.count().loads).toBe(1); // too early
    await r.advance(3100); r.api.get(r.onReady); await r.advance(0);
    expect(r.count().loads).toBe(2); expect(r.api.get(r.onReady).cls.tag).toBe('a2');
  });
  it('a build failure is retried too (volume kept)', async () => {
    const r = rig(); r.set.failBuild(1);
    r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    expect(r.api.get(r.onReady)).toBeNull();
    await r.advance(5100); r.api.get(r.onReady); await r.advance(0);
    expect(r.count()).toMatchObject({ loads: 1, builds: 2 }); expect(r.api.get(r.onReady).cls.tag).toBe('a1');
  });
  it('a permanent failure (no source data) is cached as "no cls" and not retried', async () => {
    const r = rig(); r.set.failLoad(1); r.set.permanent(true);
    r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    expect(r.api.get(r.onReady).cls).toBeNull();
    await r.advance(20000); r.api.get(r.onReady); await r.advance(0);
    expect(r.count().loads).toBe(1);
  });
  it('release drops the result and the volume, and an in-flight build is not delivered', async () => {
    const r = rig(); r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); await r.advance(0);
    r.api.release(); expect(r.api.state()).toEqual({ building: false, hasResult: false, hasVolume: false, failed: false });
    r.api.get(r.onReady); await r.advance(300); r.api.get(r.onReady); r.api.release(); await r.advance(0);
    expect(r.api.state().hasResult).toBe(false);
  });
  it('no volume (nothing open) = null and no build', async () => {
    const r = rig({ volumeKey: () => '' }); expect(r.api.get(r.onReady)).toBeNull(); await r.advance(1000);
    expect(r.count().loads).toBe(0);
  });
});
