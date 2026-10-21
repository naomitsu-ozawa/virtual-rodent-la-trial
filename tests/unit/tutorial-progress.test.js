import { describe, it, expect, beforeEach } from 'vitest';
import { TUT_KEY, emptyProgress, loadProgress, saveProgress, clearProgress, sanitizeProgress, _resetMemory } from '../../docs/tutorial-progress.js';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
beforeEach(() => _resetMemory());

describe('tutorial progress', () => {
  it('key is vrl.tutorial.v1 and empty is the default', () => {
    expect(TUT_KEY).toBe('vrl.tutorial.v1');
    expect(loadProgress(mem())).toEqual({ v: 1, done: {}, skipAll: false, last: null });
  });
  it('save then load round-trips', () => {
    const s = mem();
    expect(saveProgress({ v: 1, done: { m1: true, m2: true }, skipAll: false, last: 'm3' }, s)).toBe(true);
    expect(JSON.parse(s.m.get(TUT_KEY))).toEqual({ v: 1, done: { m1: true, m2: true }, skipAll: false, last: 'm3' });
    _resetMemory();
    expect(loadProgress(s)).toEqual({ v: 1, done: { m1: true, m2: true }, skipAll: false, last: 'm3' });
  });
  it('clear removes the key and the memory copy', () => {
    const s = mem(); saveProgress({ v: 1, done: { m1: true }, skipAll: true, last: 'm1' }, s);
    expect(clearProgress(s)).toBe(true);
    expect(s.m.has(TUT_KEY)).toBe(false);
    expect(loadProgress(s)).toEqual(emptyProgress());
  });
  it('garbage / wrong version / junk fields load as empty or sanitized', () => {
    const s = mem();
    s.setItem(TUT_KEY, '{not json'); expect(loadProgress(s)).toEqual(emptyProgress());
    s.setItem(TUT_KEY, JSON.stringify({ v: 2, done: { m1: true } })); expect(loadProgress(s)).toEqual(emptyProgress());
    s.setItem(TUT_KEY, JSON.stringify({ v: 1, done: { m1: true, m2: 'yes', m3: 1 }, skipAll: 'x', last: 5 }));
    expect(loadProgress(s)).toEqual({ v: 1, done: { m1: true }, skipAll: false, last: null });
    expect(sanitizeProgress(null)).toEqual(emptyProgress());
  });
  it('storage that throws never throws; progress stays in memory', () => {
    expect(loadProgress(broken)).toEqual(emptyProgress());
    expect(saveProgress({ v: 1, done: { m1: true }, skipAll: false, last: 'm1' }, broken)).toBe(false);
    expect(loadProgress(broken).done).toEqual({ m1: true });
    expect(clearProgress(broken)).toBe(false);
    expect(loadProgress(broken)).toEqual(emptyProgress());
  });
  it('no storage at all (undefined / throwing getter) falls back to memory', () => {
    const g = globalThis.localStorage;
    expect(saveProgress({ v: 1, done: { m2: true }, skipAll: false, last: null }, null)).toBe(false);
    expect(loadProgress(null).done).toEqual({ m2: true });
    void g;
  });
  it('loaded objects are copies', () => {
    const s = mem(); saveProgress({ v: 1, done: { m1: true }, skipAll: false, last: null }, s);
    const p = loadProgress(s); p.done.m9 = true;
    expect(loadProgress(s).done).toEqual({ m1: true });
  });
});
