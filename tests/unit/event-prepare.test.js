import { describe, it, expect } from 'vitest';
import { prepareEventLevels } from '../../docs/event-prepare.js';

const LEVELS = [{ id: 'lv0', lv: 0, sample: 'sample4' }, { id: 'lv1', lv: 1, sample: 'sample3' }, { id: 'lv2', lv: 2, sample: 'sample2' }, { id: 'lv3', lv: 3, sample: 'sample1' }];
function makeIo({ cached = [], build = () => ({ ok: true }), open = async () => {} } = {}) {
  const log = [], io = {
    isCached: async s => { log.push('cached?' + s); return cached.includes(s); },
    open: async s => { log.push('open:' + s); await open(s); }, build: async s => { log.push('build:' + s); return build(s); },
    release: () => log.push('release'), restore: async () => { log.push('restore'); },
  };
  return { io, log };
}

describe('prepareEventLevels (体験会用データを準備)', () => {
  it('opens, builds and releases each level in turn (one in memory at a time), then reopens what was open before', async () => {
    const { io, log } = makeIo(); const seen = [];
    const r = await prepareEventLevels({ levels: LEVELS, io, onStatus: s => seen.push(s.map(x => x.state).join()) });
    expect(r.ok).toBe(true); expect(r.results.map(x => x.state)).toEqual(['saved', 'saved', 'saved', 'saved']);
    expect(log.filter(l => !l.startsWith('cached?'))).toEqual(['open:sample4', 'build:sample4', 'release', 'open:sample3', 'build:sample3', 'release', 'open:sample2', 'build:sample2', 'release', 'open:sample1', 'build:sample1', 'release', 'restore']);
    expect(seen[0]).toBe('wait,wait,wait,wait'); expect(seen).toContain('building,wait,wait,wait'); expect(seen).toContain('saved,building,wait,wait'); expect(seen.at(-1)).toBe('saved,saved,saved,saved');
  });
  it('a level that is saved already is skipped (not opened, not built)', async () => {
    const { io, log } = makeIo({ cached: ['sample3', 'sample1'] });
    const r = await prepareEventLevels({ levels: LEVELS, io });
    expect(r.results.map(x => x.state)).toEqual(['saved', 'cached', 'saved', 'cached']); expect(r.ok).toBe(true);
    expect(log).not.toContain('open:sample3'); expect(log).not.toContain('build:sample1');
  });
  it('a level that could not be saved (storage) is reported with the reason, the others go on, nothing throws, and the previous level is still reopened', async () => {
    const { io, log } = makeIo({ build: s => (s === 'sample2' ? { ok: false, why: 'capacity' } : { ok: true }) });
    const r = await prepareEventLevels({ levels: LEVELS, io });
    expect(r.ok).toBe(false); expect(r.failed.map(x => x.id + ':' + x.why)).toEqual(['lv2:capacity']);
    expect(r.results.map(x => x.state)).toEqual(['saved', 'saved', 'failed', 'saved']); expect(log.at(-1)).toBe('restore');
  });
  it('an error while opening / building a level is a failed level, not a crash; the data is released after every level', async () => {
    const { io, log } = makeIo({ open: async s => { if (s === 'sample3') throw new Error('boom'); } });
    const r = await prepareEventLevels({ levels: LEVELS, io });
    expect(r.results.map(x => x.state)).toEqual(['saved', 'failed', 'saved', 'saved']); expect(r.failed[0].why).toBe('error');
    expect(log.filter(l => l === 'release').length).toBe(3 + 1);
  });
  it('a cancel stops before the next level and still restores the page', async () => {
    const { io, log } = makeIo(); let n = 0;
    const r = await prepareEventLevels({ levels: LEVELS, io, isCancelled: () => n++ >= 2 });
    expect(r.results.map(x => x.state)).toEqual(['saved', 'saved', 'wait', 'wait']); expect(log.at(-1)).toBe('restore');
  });
});
