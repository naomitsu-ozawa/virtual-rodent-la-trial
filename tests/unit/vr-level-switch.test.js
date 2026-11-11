import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sampleHasLevel, levelSwitchTargets, canSwitchData, levelSwitchItems, simpleMenuLayout, EVENT_LEVELS } from '../../docs/event-mode.js';
import { listedIds, rawOf, LEVEL_IDS, OTHER_IDS } from '../helpers/demo-lists.js';

// the data switch inside VR / AR exists only for a practice dataset that HAS a level, and goes only to datasets that have a level.
// A dataset without a level, or the visitor's own data (no practice dataset open: __vrlOpenSample null), is shown alone: no row, no tab, no switch.
// The expected sets come from docs/demo/<id>/sample.json itself (level 0 counts as a level: it is not "falsy").
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const withLevel = listedIds.filter(id => Number.isInteger(rawOf(id).level));
const byLevel = [...withLevel].sort((a, b) => rawOf(a).level - rawOf(b).level); // the order of the registry: Lv0, Lv1, ...
const withoutLevel = listedIds.filter(id => !Number.isInteger(rawOf(id).level));
const name = k => k;

describe('which data have a level (sample.json)', () => {
  it('the sample.json files split into with / without a level, and each side is not empty', () => {
    expect(withLevel.length).toBeGreaterThan(0); expect(withoutLevel.length).toBeGreaterThan(0);
    expect(withLevel.some(id => rawOf(id).level === 0)).toBe(true); // Lv0 (the tutorial's bone) is a level although 0 is falsy
    for (const id of withoutLevel) expect([null, undefined]).toContain(rawOf(id).level);
  });
  it('sampleHasLevel: true for every dataset with a level (Lv0 too), false for the others, for the visitor\'s own data (null / undefined) and for an unknown id', () => {
    for (const id of withLevel) expect(sampleHasLevel(id), id).toBe(true);
    for (const id of withoutLevel) expect(sampleHasLevel(id), id).toBe(false);
    expect(sampleHasLevel(null)).toBe(false); expect(sampleHasLevel(undefined)).toBe(false); expect(sampleHasLevel('')).toBe(false); expect(sampleHasLevel('no-such-sample')).toBe(false);
  });
  it('the registry agrees (the levels it lists are the ones sample.json gives; a duplicate level would be demoted by it, then this test says so)', () => {
    expect(EVENT_LEVELS.map(l => l.sample)).toEqual(byLevel);
    expect([...LEVEL_IDS].sort()).toEqual([...withLevel].sort()); expect(OTHER_IDS).toEqual(withoutLevel);
  });
});

describe('with a level in view: the switch is there, and its targets are the datasets with a level only', () => {
  for (const open of withLevel) {
    it(open + ': targets = every level, none without a level; items light the open one; every level is a legal press', () => {
      const t = levelSwitchTargets(open);
      expect(t.map(l => l.sample)).toEqual(byLevel);
      for (const o of withoutLevel) expect(t.some(l => l.sample === o), o).toBe(false);
      const items = levelSwitchItems(name, open, null, t);
      expect(items.map(i => i.sample)).toEqual(byLevel);
      expect(items.filter(i => i.on).map(i => i.sample)).toEqual([open]);
      for (const to of withLevel) expect(canSwitchData(open, to), open + ' -> ' + to).toBe(true);
      for (const to of withoutLevel) expect(canSwitchData(open, to), open + ' -> ' + to).toBe(false); // never switched to data without a level
      expect(canSwitchData(open, null)).toBe(false); expect(canSwitchData(open, '')).toBe(false);
    });
  }
  it('the かんたん menu row of such data has one button per level and none for a dataset without one', () => {
    const base = { segments: [], sectionOn: false, sliceOpacity: 0.6, trigger: { show: false }, results: [], total: '0', text: new Proxy({}, { get: (_, k) => String(k) }) };
    const open = withLevel[0], levels = { items: levelSwitchItems(name, open, null, levelSwitchTargets(open)), busy: false, hint: '', text: { title: 'D', again: 'A' } };
    const ids = simpleMenuLayout({ ...base, levels }).filter(w => w.id?.startsWith('level:')).map(w => w.id);
    expect(ids).toEqual(EVENT_LEVELS.map(l => 'level:' + l.id));
    expect(ids.length).toBe(withLevel.length);
  });
});

describe('without a level in view: no items, no row, no switch', () => {
  for (const open of withoutLevel) {
    it(open + ' (no level): no targets, no items, nothing can be pressed', () => {
      expect(levelSwitchTargets(open)).toEqual([]);
      expect(levelSwitchItems(name, open, null, levelSwitchTargets(open))).toEqual([]);
      for (const to of listedIds) expect(canSwitchData(open, to), open + ' -> ' + to).toBe(false);
    });
  }
  it('the visitor\'s own data (a DICOM they opened: __vrlOpenSample null): no targets, no items, nothing can be pressed', () => {
    expect(levelSwitchTargets(null)).toEqual([]); expect(levelSwitchTargets(undefined)).toEqual([]);
    expect(levelSwitchItems(name, null, null, levelSwitchTargets(null))).toEqual([]);
    for (const to of listedIds) { expect(canSwitchData(null, to)).toBe(false); expect(canSwitchData(undefined, to)).toBe(false); }
  });
  it('the かんたん menu layout with no row (levels: null) has no level button', () => {
    const base = { segments: [], sectionOn: false, sliceOpacity: 0.6, trigger: { show: false }, results: [], total: '0', text: new Proxy({}, { get: (_, k) => String(k) }) };
    expect(simpleMenuLayout({ ...base, levels: null }).some(w => String(w.id).startsWith('level:') || w.id === 'levels:name')).toBe(false);
  });
});

describe('vr-view.js wiring (a WebXR file, checked on its source like the rest of the data switch)', () => {
  it('every entry decides from the open data\'s level: the press itself, the かんたん row, the full menu\'s tab bar and the tab', () => {
    expect(src).toContain('const levelSwitchOn=()=>sampleHasLevel(globalThis.__vrlOpenSample);');
    expect(src).toContain('if(ui.swapBusy||!setId||!canSwitchData(globalThis.__vrlOpenSample,setId))return;'); // swapPress: the one place every entry ends in (level:<id> actions, the tab's buttons)
    expect(src).toContain('(eventModeOn()||(tutLive&&!tutEnded))&&levelSwitchOn()?{items:levelSwitchItems('); // the かんたん menu's row
    expect(src).toContain("filter(i=>TAB_IDS[i]!==11||levelSwitchOn()||pairRowOn())"); // the tab bar: no データ tab (a dataset with no level and no partner; stage 3: a dataset with a partner has the tab for its pair row only)
    expect(src).toContain('if(ui.tab===11&&!(levelSwitchOn()||pairRowOn()))ui.tab=0;'); // and never an open one
    expect(src).toContain('const dsList=levelSwitchTargets(globalThis.__vrlOpenSample);'); // the tab's rows: levels only
  });
  it('swapData is called from swapPress only (no other way in), the old own-data line and the dataset-wide list are gone', () => {
    expect([...src.matchAll(/void swapData\(/g)].length).toBe(1);
    expect(src).not.toContain('practiceOpen');
    expect(src).not.toContain('EVENT_DATASETS');
    expect(src).not.toContain('eventModeOn()?EVENT_DATASETS');
  });
});
