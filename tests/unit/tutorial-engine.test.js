import { describe, it, expect } from 'vitest';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';

const memProgress = (init) => { let p = init || { v: 1, done: {}, skipAll: false, last: null }; const log = { saves: 0, clears: 0 };
  return { load: () => ({ ...p, done: { ...p.done } }), save: q => { p = JSON.parse(JSON.stringify(q)); log.saves++; }, clear: () => { p = { v: 1, done: {}, skipAll: false, last: null }; log.clears++; }, get: () => p, log }; };
const mk = (o = {}) => { const progress = o.progress || memProgress(); return { progress, e: createTutorialEngine({ progress, ...o }) }; };
const sig = (e, kind, count) => e.onSignal({ kind, count });
function finish(e, id) { e.start(id); for (const s of e.currentStep() ? TUTORIAL_MISSIONS.find(m => m.id === id).steps : []) for (let i = 0; i < s.done.count; i++) sig(e, s.done.signal); }

describe('tutorial engine: sequencing', () => {
  it('idle at first; only m1 is unlocked', () => {
    const { e } = mk();
    expect(e.getState()).toMatchObject({ mission: null, step: 0, done: {} });
    expect(e.pageInfo()).toBeNull();
    expect(e.listMissions().map(m => m.status)).toEqual(['available', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked']);
    expect(e.listMissions().map(m => m.stepNo)).toEqual([1, 2, 3, 4, 5, 6, 7]); // ステップN: fixed by the order
    expect(e.start('m2')).toBe(false);
    expect(e.start('nope')).toBe(false);
  });
  it('steps advance in order on the right signal only', () => {
    const { e } = mk();
    expect(e.start('m1')).toBe(true);
    expect(sig(e, 'scale')).toBe(false); // step 1 wants move
    expect(e.getState().step).toBe(0);
    expect(sig(e, 'move')).toBe(true);
    expect(e.getState().step).toBe(1);
    sig(e, 'scale');
    expect(e.getState().step).toBe(2);
    expect(e.getState().finished).toBe(false);
    sig(e, 'home');
    expect(e.getState()).toMatchObject({ finished: true, done: { m1: true } });
    expect(e.isUnlocked('m2')).toBe(true);
    expect(e.nextMissionId()).toBe('m2');
  });
  it('signals are ignored while idle or finished', () => {
    const { e } = mk();
    expect(sig(e, 'move')).toBe(false);
    finish(e, 'm1');
    expect(sig(e, 'home')).toBe(false);
  });
  it('count: m6 needs two point-record signals; count payload adds up', () => {
    const { e } = mk({ progress: memProgress({ v: 1, done: {}, skipAll: true, last: null }) });
    e.start('m6');
    sig(e, 'point-record');
    expect(e.getState()).toMatchObject({ step: 0, count: 1 });
    sig(e, 'point-record');
    expect(e.getState()).toMatchObject({ step: 1, count: 0 });
    e.start('m6'); sig(e, 'point-record', 2);
    expect(e.getState().step).toBe(1);
    e.start('m6'); sig(e, 'point-record', 0); sig(e, 'point-record', 'x'); // junk count = 1 each
    expect(e.getState().step).toBe(1);
  });
  it('progress is saved on completion and restored by a new engine', () => {
    const { e, progress } = mk();
    finish(e, 'm1');
    expect(progress.get().done).toEqual({ m1: true });
    const e2 = createTutorialEngine({ progress });
    expect(e2.isDone('m1')).toBe(true);
    expect(e2.isUnlocked('m2')).toBe(true);
    expect(e2.getState().mission).toBeNull();
  });
  it('a done mission can be started again', () => {
    const { e } = mk(); finish(e, 'm1');
    expect(e.start('m1')).toBe(true);
    expect(e.getState()).toMatchObject({ step: 0, finished: false });
    expect(e.getState().done.m1).toBe(true);
  });
});

describe('tutorial engine: unlock rules', () => {
  it('M(n) done unlocks M(n+1) one by one', () => {
    const { e } = mk();
    for (const id of ['m1', 'm2', 'm3']) { expect(e.isUnlocked(id)).toBe(true); finish(e, id); }
    expect(e.listMissions().slice(0, 5).map(m => m.status)).toEqual(['done', 'done', 'done', 'available', 'locked']);
  });
  it('M7 (AR) is unavailable without AR, keeps its number (ステップ7) and blocks nothing; with AR it is the last step to do', () => {
    const { e } = mk({ arAvailable: false });
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) finish(e, id);
    expect(e.listMissions()[6]).toMatchObject({ status: 'unavailable', reason: 'tutNoAr', stepNo: 7 });
    expect(e.start('m7')).toBe(false);
    expect(e.nextMissionId()).toBeNull();
    e.setEnv({ arAvailable: true });
    expect(e.listMissions()[6]).toMatchObject({ status: 'available', stepNo: 7 });
    expect(e.nextMissionId()).toBe('m7');
  });
  it('there is no analysis step any more (no m8, no analysis flag, no hasAnalysis env)', () => {
    const { e } = mk();
    expect(e.listMissions()).toHaveLength(7);
    expect(TUTORIAL_MISSIONS.some(m => m.requiresAnalysis)).toBe(false);
    expect(e.listMissions().every(m => m.reason !== 'tutNoAnalysis')).toBe(true);
    e.setEnv({ hasAnalysis: false }); // an unknown key is ignored
    expect(e.listMissions().map(m => m.status)).toEqual(['available', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked']);
  });
  it('an optional mission (generic flag, no mission uses it now) never blocks and is not nextMissionId over a real one', () => {
    const st = id => [{ id: id + 's', text: 't', audio: id + 's', audioText: 'abcd', done: { signal: 'move', count: 1 } }];
    const missions = [{ id: 'a', sample: 'sample4', title: 't', steps: st('a') }, { id: 'o', sample: 'sample4', title: 't', optional: true, steps: st('o') }, { id: 'b', sample: 'sample4', title: 't', steps: st('b') }];
    const e = createTutorialEngine({ missions, progress: memProgress() });
    e.start('a'); sig(e, 'move');
    expect(e.isUnlocked('b')).toBe(true); expect(e.nextMissionId()).toBe('b');
    e.start('b'); sig(e, 'move');
    expect(e.nextMissionId()).toBe('o');
  });
  it('setEnv closes a running mission that became unavailable', () => {
    const { e } = mk({ progress: memProgress({ v: 1, done: {}, skipAll: true, last: null }) });
    e.start('m7'); e.setEnv({ arAvailable: false });
    expect(e.getState().mission).toBeNull();
  });
});

describe('tutorial engine: skip and reset', () => {
  it('skipMission marks done, finishes the running one and unlocks the next', () => {
    const { e, progress } = mk();
    e.start('m1'); e.skipMission();
    expect(e.getState()).toMatchObject({ finished: true, done: { m1: true } });
    expect(progress.get().done.m1).toBe(true);
    expect(e.isUnlocked('m2')).toBe(true);
    expect(e.skipMission('zzz')).toBe(false);
  });
  it('skipMission(id) of another mission does not disturb the running one', () => {
    const { e } = mk(); e.start('m1'); sig(e, 'move');
    e.skipMission('m1x'); e.skipMission('m2');
    expect(e.getState()).toMatchObject({ mission: 'm1', step: 1, finished: false });
    expect(e.getState().done.m2).toBe(true);
  });
  it('skipAll opens and checks everything, and persists skipAll', () => {
    const { e, progress } = mk();
    e.skipAll();
    expect(e.listMissions().every(m => m.status === 'done' || m.status === 'unavailable')).toBe(true);
    expect(Object.keys(e.getState().done)).toHaveLength(7);
    expect(progress.get().skipAll).toBe(true);
    expect(e.start('m5')).toBe(true);
    expect(e.nextMissionId()).toBeNull();
  });
  it('reset clears storage and returns to idle with only m1 open', () => {
    const { e, progress } = mk();
    finish(e, 'm1'); e.skipAll(); e.start('m3');
    e.reset();
    expect(progress.log.clears).toBe(1);
    expect(progress.get()).toEqual({ v: 1, done: {}, skipAll: false, last: null });
    expect(e.getState()).toMatchObject({ mission: null, done: {}, skipAll: false });
    expect(e.listMissions().map(m => m.status)[0]).toBe('available');
    expect(e.isUnlocked('m2')).toBe(false);
  });
});

describe('tutorial engine: carousel paging (n/N, prev / next)', () => {
  it('pageInfo follows the step', () => {
    const { e } = mk(); e.start('m1');
    expect(e.pageInfo()).toEqual({ n: 1, N: 3, hasPrev: false, hasNext: true, isLast: false, finished: false });
    e.next();
    expect(e.pageInfo()).toMatchObject({ n: 2, N: 3, hasPrev: true });
    e.next();
    expect(e.pageInfo()).toMatchObject({ n: 3, N: 3, isLast: true, finished: false });
  });
  it('next() by hand advances without a signal; on the last step it finishes the mission', () => {
    const { e } = mk(); e.skipMission('m1'); e.start('m2');
    e.next(); e.next();
    expect(e.getState().finished).toBe(false);
    e.next();
    expect(e.getState()).toMatchObject({ finished: true, done: { m2: true } });
    expect(e.pageInfo()).toMatchObject({ n: 3, N: 3, finished: true, hasNext: false, hasPrev: true });
  });
  it('prev() goes back, resets the step count, stops at the first step', () => {
    const { e } = mk({ progress: memProgress({ v: 1, done: {}, skipAll: true, last: null }) });
    e.start('m6'); sig(e, 'point-record'); expect(e.getState().count).toBe(1);
    expect(e.prev()).toBe(false);
    sig(e, 'point-record'); expect(e.getState().step).toBe(1);
    expect(e.prev()).toBe(true);
    expect(e.getState()).toMatchObject({ step: 0, count: 0 });
    expect(e.prev()).toBe(false);
  });
  it('prev() on the finished page returns to the last step', () => {
    const { e } = mk(); finish(e, 'm1'); finish(e, 'm2');
    expect(e.getState().finished).toBe(true);
    expect(e.prev()).toBe(true);
    expect(e.getState()).toMatchObject({ finished: false, step: 2 });
    sig(e, 'menu-close');
    expect(e.getState().finished).toBe(true);
  });
  it('next / prev are harmless while idle', () => {
    const { e } = mk();
    expect(e.prev()).toBe(false); e.next();
    expect(e.getState().mission).toBeNull();
  });
});

describe('tutorial engine: subscription', () => {
  it('notifies on change with a snapshot, unsubscribe stops it, a throwing listener is isolated', () => {
    const { e } = mk(); const seen = [];
    e.subscribe(() => { throw new Error('boom'); });
    const off = e.subscribe(s => seen.push([s.mission, s.step, s.count]));
    e.start('m1'); sig(e, 'move'); sig(e, 'home'); // wrong kind: no notification
    expect(seen).toEqual([['m1', 0, 0], ['m1', 1, 0]]);
    off(); e.next();
    expect(seen).toHaveLength(2);
  });
  it('snapshots are copies', () => {
    const { e } = mk(); const s = e.getState(); s.done.m9 = true;
    expect(e.getState().done.m9).toBeUndefined();
  });
  it('a failing progress store does not break the engine', () => {
    const progress = { load: () => ({ v: 1, done: {}, skipAll: false, last: null }), save() { throw new Error('x'); }, clear() { throw new Error('x'); } };
    const e = createTutorialEngine({ progress });
    finish(e, 'm1'); e.reset();
    expect(e.getState().mission).toBeNull();
  });
});

describe('tutorial engine: spoken feedback', () => {
  const watch = e => { const l = []; e.subscribe(s => l.push([s.feedback, s.feedbackItem?.id ?? null])); return l; };
  it('signal clears rotate ok1..ok3, the final step gives missionClear, manual paging gives nothing', () => {
    const { e } = mk(); const l = watch(e);
    e.start('m1'); sig(e, 'move'); sig(e, 'scale'); sig(e, 'home');
    expect(l).toEqual([[null, null], ['stepClear', 'ok1'], ['stepClear', 'ok2'], ['missionClear', 'mclear']]);
    e.start('m2'); l.length = 0;
    e.next(); e.prev(); e.next(); // by hand
    expect(l.map(x => x[0])).toEqual([null, null, null]);
    sig(e, 'menu-close'); // step 2 wants seg-toggle: no clear
    expect(l.at(-1)[0]).toBeNull();
  });
  it('rotation wraps; count-only signals and wrong kinds earn nothing; feedback is delivered once', () => {
    const { e } = mk({ progress: memProgress({ v: 1, done: {}, skipAll: true, last: null }) }); const l = watch(e);
    e.start('m6'); sig(e, 'point-record'); // count 1 of 2
    expect(l.map(x => x[0])).toEqual([null, null]);
    sig(e, 'point-record'); expect(l.at(-1)).toEqual(['stepClear', 'ok1']);
    e.prev(); expect(l.at(-1)[0]).toBeNull();
    e.start('m1'); sig(e, 'move'); sig(e, 'scale'); e.start('m2'); sig(e, 'menu-open');
    expect(l.filter(x => x[0] === 'stepClear').map(x => x[1])).toEqual(['ok1', 'ok2', 'ok3', 'ok1']);
  });
  it('next() on the last page finishes the mission with missionClear', () => {
    const { e } = mk(); const l = watch(e);
    e.start('m1'); e.next(); e.next(); l.length = 0; e.next();
    expect(l).toEqual([['missionClear', 'mclear']]);
  });
  it('the last mission that exists on this device gives allClear (M7 AR exists: after it; no AR: m6 is the last)', () => {
    const done5 = { v: 1, done: { m1: true, m2: true, m3: true, m4: true, m5: true }, skipAll: false, last: null };
    const { e } = mk({ progress: memProgress(done5) }); const l = watch(e);
    e.start('m6'); sig(e, 'point-record', 2); sig(e, 'measure-done');
    expect(l.at(-1)).toEqual(['missionClear', 'mclear']); // m7 (AR) still to do
    finish(e, 'm7');
    expect(l.at(-1)).toEqual(['allClear', 'allclear']);
    const noAr = mk({ arAvailable: false, progress: memProgress(done5) }); const l2 = watch(noAr.e);
    noAr.e.start('m6'); sig(noAr.e, 'point-record', 2); sig(noAr.e, 'measure-done');
    expect(l2.at(-1)).toEqual(['allClear', 'allclear']);
  });
  it('skips, reset and setEnv give no feedback; feedbackSeq counts the earned ones', () => {
    const { e } = mk(); const l = watch(e); const seqs = []; e.subscribe(s => seqs.push(s.feedbackSeq));
    e.start('m1'); e.skipMission(); e.skipAll(); e.reset(); e.setEnv({ arAvailable: false });
    expect(l.every(x => x[0] === null)).toBe(true);
    e.start('m1'); sig(e, 'move');
    expect(seqs.at(-1)).toBe(1);
  });
});

describe('tutorial feedback data', () => {
  it('lines are short, have audio ids and ja/en subtitles', async () => {
    const { TUT_FEEDBACK } = await import('../../docs/tutorial-data.js');
    const { I18N } = await import('../../docs/i18n.js');
    const all = [...TUT_FEEDBACK.stepClear, TUT_FEEDBACK.missionClear, TUT_FEEDBACK.allClear];
    expect(all.map(x => x.id)).toEqual(['ok1', 'ok2', 'ok3', 'mclear', 'allclear']);
    for (const x of all) { expect(x.audio).toBe(x.id); expect(x.audioText.length).toBeLessThanOrEqual(20); for (const l of ['ja', 'en']) expect(I18N[l][x.text]).toBeTruthy(); }
    expect(TUTORIAL_MISSIONS.flatMap(m => m.steps).map(s => s.audio)).not.toContain('ok1');
  });
});
