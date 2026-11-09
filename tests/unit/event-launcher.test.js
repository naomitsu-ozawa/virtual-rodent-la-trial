import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { EVENT_LEVELS, EVENT_OTHER_SAMPLES, EVENT_DATASETS, buildEventDatasets, datasetForSample, datasetLabel, levelSwitchItems } from '../../docs/event-mode.js';
import { eventCards, eventStatus, EVENT_STATUS_KEYS, openAndPrepare, waitForStandardOpen, createInflight } from '../../docs/event-launcher-core.js';
import { SAMPLE_CREDITS } from '../../docs/sample-credits.js';
import { I18N } from '../../docs/i18n.js';

const SRC = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');

// the 体験会モード page. The card list, the license line, the in-VR data switch, the pre-cache targets, the status text, the order after a card press and the one-run guard.
describe('the datasets of the event page: ONE list', () => {
  it('Lv0-Lv3 first, then the practice datasets that are not levels (the marmoset): five datasets, sample1-5', () => {
    expect(EVENT_DATASETS.map(d => d.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5']);
    expect(EVENT_DATASETS.map(d => d.kind)).toEqual(['level', 'level', 'level', 'level', 'other']);
    expect(EVENT_DATASETS.map(d => d.lv)).toEqual([0, 1, 2, 3, null]);
    expect(Object.isFrozen(EVENT_DATASETS) && Object.isFrozen(EVENT_DATASETS[4])).toBe(true);
    expect(datasetForSample('sample5').nameKey).toBe('sampleMarmoset');
    expect(datasetForSample('sample9')).toBeNull();
    expect(datasetLabel(EVENT_DATASETS[0], k => k)).toBe('Lv0 evLv0Name');
    expect(datasetLabel(EVENT_DATASETS[4], k => k)).toBe('sampleMarmoset');
  });
  it('the cards, the in-VR data tab and the pre-cache all read it: a dataset registered later appears in each of them', () => {
    const more = buildEventDatasets(EVENT_LEVELS, [...EVENT_OTHER_SAMPLES, { sample: 'sample9', nameKey: 'sampleNine' }]);
    expect(more.map(d => d.sample).at(-1)).toBe('sample9');
    expect(eventCards(more).map(c => c.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5', 'sample9']);
    expect(levelSwitchItems(k => k, null, null, more).map(i => i.sample).at(-1)).toBe('sample9');
    // the three consumers are written against EVENT_DATASETS, not against a list of their own
    expect(SRC('event-launcher-core.js')).toContain('eventCards(datasets = EVENT_DATASETS');
    expect(SRC('event-prepare-ui.js')).toContain('EVENT_DATASETS.map(d =>');
    expect(SRC('vr-view.js')).toContain('const dsList=eventModeOn()?EVENT_DATASETS:EVENT_LEVELS;');
    expect(SRC('event-launcher.js')).toContain('eventCards()');
  });
});

describe('the cards', () => {
  const cards = eventCards();
  it('one card per dataset, in order, with the existing texts (names / missions) and the data-event-level attribute of the levels only', () => {
    expect(cards.map(c => c.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5']);
    expect(cards.map(c => c.levelAttr)).toEqual(['lv0', 'lv1', 'lv2', 'lv3', null]);
    expect(cards.map(c => c.nameKey)).toEqual(['evLv0Name', 'evLv1Name', 'evLv2Name', 'evLv3Name', 'sampleMarmoset']);
    expect(cards.map(c => c.missionKey)).toEqual(['evLv0Mission', 'evLv1Mission', 'evLv2Mission', 'evLv3Mission', null]);
    for (const lang of ['ja', 'en']) for (const c of cards) { expect(typeof I18N[lang][c.nameKey]).toBe('string'); if (c.missionKey) expect(typeof I18N[lang][c.missionKey]).toBe('string'); }
  });
  it('a thumbnail slot per card: docs/demo/<sampleN>/thumb.webp', () => {
    for (const c of cards) expect(c.thumbFile).toBe('thumb.webp');
    const ui = SRC('event-launcher.js');
    expect(ui).toContain('sampleSliceUrl(c.sample, c.thumbFile)'); // the data folder of the dataset (resolved like its slices)
    expect(ui).toContain('img.onerror = () => img.remove()'); // no file: the frame stays empty, no text
    expect(ui).toContain("img.alt = ''");
  });
  it('the license line is only on the marmoset card (sample5), from sample-credits.js; sample1-4 have none', () => {
    expect(cards.filter(c => c.license).map(c => c.sample)).toEqual(['sample5']);
    expect(cards.find(c => c.sample === 'sample5').license).toEqual({ name: SAMPLE_CREDITS.sample5.licenseName, url: SAMPLE_CREDITS.sample5.licenseUrl });
    expect(SAMPLE_CREDITS.sample5.licenseName).toBe('CC BY-NC-SA 4.0');
    for (const s of ['sample1', 'sample2', 'sample3', 'sample4']) expect(cards.find(c => c.sample === s).license).toBeNull();
    for (const lang of ['ja', 'en']) expect(typeof I18N[lang].creditLicense).toBe('string');
  });
});

describe('the in-VR data switch', () => {
  it('the items include the marmoset as a fifth one (plain name); the かんたん menu row is passed the four levels explicitly (no room for a fifth button there)', () => {
    const name = k => k, items = levelSwitchItems(name, 'sample3', 'lv2');
    expect(items.map(i => i.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5']);
    expect(items.map(i => i.id)).toEqual(['lv0', 'lv1', 'lv2', 'lv3', 'sample5']);
    expect(items.find(i => i.sample === 'sample3').on).toBe(true);
    expect(items.find(i => i.id === 'lv2').armed).toBe(true);
    expect(levelSwitchItems(name, 'sample5', 'sample5').find(i => i.sample === 'sample5')).toMatchObject({ on: true, armed: true, label: 'sampleMarmoset' });
    expect(levelSwitchItems(name, null, null, EVENT_LEVELS).map(i => i.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1']);
    const vr = SRC('vr-view.js');
    expect(vr).toContain('levelSwitchItems(tr,globalThis.__vrlOpenSample,datasetForSample(al)?.id??null,dsList)'); // the full menu's データ tab: every dataset ...
    expect(vr).toContain('const dsList=eventModeOn()?EVENT_DATASETS:EVENT_LEVELS;'); // ... with the event mode on only (off: the four levels, as before)
    expect(vr).toContain('levelForSample(swapArmedId())?.id??null,EVENT_LEVELS),busy:ui.swapBusy'); // the row of the かんたん menu: unchanged
    expect(vr).toContain('const dEnd=y0+150+dsList.length*96;'); // the lines under the rows follow the number of rows
    expect(vr).toContain('const levelNameOf=id=>{const l=datasetForSample(id);return l?datasetLabel(l,tr):String(id)};');
  });
  it('the existing mechanism is the one used: two presses (resetPress), the swapBusy lock, runDataSwap - nothing new for the marmoset', () => {
    const vr = SRC('vr-view.js');
    expect(vr).toContain('const swapPress=setId=>{\n  if(ui.swapBusy||!setId)return;');
    expect(vr).toContain('void swapData(setId)');
    expect(vr).toContain('r=await runDataSwap(env,setId,gen)');
    expect(vr).toContain('chooseEventLevel(lv?lv.id:null)'); // a dataset that is not a level chooses none
  });
});

describe('体験会用データを準備: the marmoset is a target', () => {
  beforeAll(() => { installDomStub(); });
  it('runEventPrepare prepares the five datasets in order (the cached ones are skipped, the restore reopens the earlier one)', async () => {
    const m = await importApp('event-prepare-ui');
    const seen = [], opened = [];
    const vr = { standardLevelCached: async () => true, prepareStandardLevel: async () => ({ ok: true }), releaseVrPrepared: () => {} };
    const out = await m.runEventPrepare({ getVr: async () => vr, openLevel: async s => { opened.push(s); }, onStatus: r => seen.push(r.map(x => x.sample + ':' + x.state).join()) });
    expect(out.ok).toBe(true);
    expect(out.results.map(r => r.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5']);
    expect(out.results.at(-1)).toMatchObject({ id: 'sample5', lv: null, nameKey: 'sampleMarmoset', state: 'cached' });
    expect(opened).toEqual([]);
    expect(seen.at(-1)).toBe('sample4:cached,sample3:cached,sample2:cached,sample1:cached,sample5:cached');
  });
  it('the reports name the marmoset by its own name (it has no Lv number), the levels as before', async () => {
    const m = await importApp('event-prepare-ui');
    const r = EVENT_DATASETS.map(d => ({ id: d.id, lv: d.lv, nameKey: d.nameKey, sample: d.sample, state: 'saved' }));
    expect(m.statusLine(r)).toContain('Lv0 ');
    expect(m.statusLine(r)).toContain(I18N.ja.sampleMarmoset + ' ');
    expect(m.statusLine(r)).not.toContain('Lvnull');
    expect(m.statusLine(r)).not.toContain('Lvundefined');
    expect(m.targetTag(r[4])).toBe(I18N.ja.sampleMarmoset);
    expect(m.targetTag(r[3])).toBe('Lv3');
  });
});

describe('the status text', () => {
  it('three states: loading, preparing, ready; nothing to say before a dataset was chosen', () => {
    expect(eventStatus({})).toBe('');
    expect(eventStatus({ loading: true })).toBe('loading');
    expect(eventStatus({ preparing: true })).toBe('preparing');
    expect(eventStatus({ ready: true })).toBe('ready');
    expect(eventStatus({ loading: true, preparing: true, ready: true })).toBe('loading'); // the earliest step wins
    expect(eventStatus({ preparing: true, ready: true })).toBe('preparing');
  });
  it('the texts are the three new strings, in ja and en (and only these)', () => {
    expect([I18N.ja[EVENT_STATUS_KEYS.loading], I18N.ja[EVENT_STATUS_KEYS.preparing], I18N.ja[EVENT_STATUS_KEYS.ready]]).toEqual(['読み込み中…', '準備中…', '準備完了']);
    expect([I18N.en[EVENT_STATUS_KEYS.loading], I18N.en[EVENT_STATUS_KEYS.preparing], I18N.en[EVENT_STATUS_KEYS.ready]]).toEqual(['Loading…', 'Preparing…', 'Ready']);
  });
});

describe('after a card press: open, wait, prepare', () => {
  it('runs in that order and reports loading -> preparing -> ready', async () => {
    const log = [], phases = [];
    const out = await openAndPrepare({ open: async () => { log.push('open'); }, settle: async () => { log.push('settle'); }, prepare: async () => { log.push('prepare'); }, onPhase: p => phases.push(p) });
    expect(out).toBe('ready');
    expect(log).toEqual(['open', 'settle', 'prepare']);
    expect(phases).toEqual(['loading', 'preparing', 'ready']);
  });
  it('another card pressed meanwhile (stale): the old run stops at once, no later step runs and it is never "ready"', async () => {
    for (const staleAfter of [1, 2, 3]) {
      const log = [], phases = []; let checks = 0;
      const out = await openAndPrepare({ open: async () => { log.push('open'); }, settle: async () => { log.push('settle'); }, prepare: async () => { log.push('prepare'); }, onPhase: p => phases.push(p), isStale: () => ++checks >= staleAfter });
      expect(out).toBe('stale');
      expect(phases).not.toContain('ready');
      expect(log.length).toBe(staleAfter);
    }
  });
  it('a step that fails rejects (the page then shows no status and the VR button prepares as usual)', async () => {
    await expect(openAndPrepare({ open: async () => {}, settle: async () => {}, prepare: async () => { throw new Error('boom'); } })).rejects.toThrow('boom');
  });
});

describe('the preparation waits for the standard-open record', () => {
  const noSleep = () => { const log = []; return { log, sleep: async ms => { log.push(ms); } }; };
  it('openAndPrepare: open -> settle -> standard -> prepare', async () => {
    const log = [];
    await openAndPrepare({ open: async () => { log.push('open'); }, settle: async () => { log.push('settle'); }, standard: async () => { log.push('standard'); }, prepare: async () => { log.push('prepare'); } });
    expect(log).toEqual(['open', 'settle', 'standard', 'prepare']);
  });
  it('prepare does not start before the record is set: it is read again every pollMs until it is there', async () => {
    let rec = null, polls = 0; const log = [], s = noSleep();
    const sleep = async ms => { s.log.push(ms); if (++polls === 3) rec = { id: 'sample1', sig: 'x' }; };
    await openAndPrepare({ open: async () => {}, settle: async () => {}, standard: () => waitForStandardOpen({ sample: 'sample1', read: () => rec, sleep, pollMs: 100 }).then(ok => log.push('standard:' + ok)), prepare: async () => { log.push('prepare'); } });
    expect(log).toEqual(['standard:true', 'prepare']);
    expect(s.log).toEqual([100, 100, 100]);
  });
  it('a record of another dataset (or none) does not count; the wait is bounded (timeoutMs / pollMs sleeps) and then the preparation goes on', async () => {
    const s = noSleep();
    expect(await waitForStandardOpen({ sample: 'sample1', read: () => ({ id: 'sample2' }), sleep: s.sleep, timeoutMs: 1000, pollMs: 100 })).toBe(false);
    expect(s.log.length).toBe(10);
    const s2 = noSleep();
    expect(await waitForStandardOpen({ sample: 'sample1', read: () => null, sleep: s2.sleep })).toBe(false);
    expect(s2.log.length).toBe(100); // default: 10 s in 100 ms steps
  });
  it('already set: no wait; not a practice dataset: no wait; a stale run stops waiting; a throwing read is "not set"', async () => {
    const s = noSleep();
    expect(await waitForStandardOpen({ sample: 'sample3', read: () => ({ id: 'sample3' }), sleep: s.sleep })).toBe(true);
    expect(await waitForStandardOpen({ sample: 'other', read: () => null, sleep: s.sleep })).toBe(false);
    expect(await waitForStandardOpen({ sample: 'sample1', read: () => null, sleep: s.sleep, stop: () => true })).toBe(false);
    expect(await waitForStandardOpen({ sample: 'sample1', read: () => { throw new Error('x'); }, sleep: s.sleep, timeoutMs: 200, pollMs: 100 })).toBe(false);
    expect(s.log).toEqual([100, 100]); // only the last (bounded) case slept
  });
  it('event-launcher.js passes the wait as the step between settle and prepare', () => {
    const ui = SRC('event-launcher.js');
    expect(ui).toContain("standard: () => waitForStandardOpen({ sample: d.sample, read: () => g.__vrlStandardOpen");
    expect(ui.indexOf('settle: () => settlePage(g)')).toBeLessThan(ui.indexOf('standard: () => waitForStandardOpen'));
  });
});

describe('no double preparation', () => {
  it('a run in flight is shared: the second caller gets the same promise and the work starts once', async () => {
    const f = createInflight(); let started = 0, release; const gate = new Promise(r => { release = r; });
    const work = () => { started++; return gate.then(() => 'prepared'); };
    const a = f.run('vr', work), b = f.run('vr', work);
    expect(b).toBe(a); expect(f.has('vr')).toBe(true);
    release(); expect(await a).toBe('prepared'); expect(await b).toBe('prepared');
    expect(started).toBe(1);
    expect(f.has('vr')).toBe(false); // a finished run is forgotten: the next press prepares again if needed
    await f.run('vr', work); expect(started).toBe(2);
  });
  it('another key is another run; a failed run is forgotten too', async () => {
    const f = createInflight(); let n = 0;
    await Promise.all([f.run('vr', async () => { n++; }), f.run('ar', async () => { n++; })]);
    expect(n).toBe(2);
    await expect(f.run('vr', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(f.has('vr')).toBe(false);
  });
  it('vr-view.js: the prepare panel and the card press share the GPU run (prepareVrGpuOnce); the button takes the panel while it runs (vrGpuBusy)', () => {
    const vr = SRC('vr-view.js'), app = SRC('app.js');
    expect(vr).toContain('g=await prepareVrGpuOnce(p,mode)}');
    expect(vr).toContain('if(gpuInflight&&gpuInflight.key===P.key&&gpuInflight.mode===mode)return gpuInflight.promise;');
    expect(vr).toContain('export const vrGpuBusy=()=>!!gpuInflight;');
    expect(app).toContain('if(m.vrReady()&&!m.vrGpuBusy())await go();else{');
    const ui = SRC('event-launcher.js');
    expect(ui).toContain("inflight.run('vr', async () => {");
    expect(ui).not.toMatch(/\bimport\(/); // the VR module comes from app.js (event 'vrl-vr-module'): no second loader (the export gate pins the dynamic imports of the pages)
    expect(app).toContain("document.addEventListener('vrl-vr-module',e=>{e.detail.done=vrModule()});");
    expect(ui).toContain('await m.prepareVrData(() => {});');
    expect(ui).toContain("await m.prepareVrGpuOnce(P, 'vr');");
  });
});

// ---- the page itself, on a tiny fake DOM (the test environment has none)
function fakeDom() {
  const doc = new EventTarget();
  const camel = k => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const match = (e, sel) => {
    if (sel.startsWith('#')) return e.id === sel.slice(1);
    if (sel.startsWith('.')) return e.className.split(/\s+/).includes(sel.slice(1));
    const m = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(sel); // [data-x] / [data-x="v"]
    return !!m && camel(m[1]) in e.dataset && (m[2] === undefined || e.dataset[camel(m[1])] === m[2]);
  };
  const node = (tag, isComment = false) => {
    const e = { tag, isComment, id: '', className: '', hidden: false, disabled: false, dataset: {}, children: [], parentNode: null, attrs: {}, _text: '', onclick: null, onerror: null,
      classList: { add: c => { if (!e.className.split(/\s+/).includes(c)) e.className = (e.className + ' ' + c).trim(); }, remove: c => { e.className = e.className.split(/\s+/).filter(x => x && x !== c).join(' '); }, toggle: (c, on) => (on ? e.classList.add(c) : e.classList.remove(c)), contains: c => e.className.split(/\s+/).includes(c) },
      setAttribute: (k, v) => { e.attrs[k] = String(v); }, getAttribute: k => e.attrs[k] ?? null,
      get textContent() { return e._text; }, set textContent(v) { e._text = String(v); },
      append: (...k) => k.forEach(c => { c.remove?.(); c.parentNode = e; e.children.push(c); }),
      insertBefore: (c, ref) => { c.remove?.(); c.parentNode = e; const i = ref ? e.children.indexOf(ref) : -1; if (i < 0) e.children.push(c); else e.children.splice(i, 0, c); },
      after: c => { c.remove?.(); const p = e.parentNode, i = p.children.indexOf(e); c.parentNode = p; p.children.splice(i + 1, 0, c); },
      replaceWith: c => { const p = e.parentNode, i = p.children.indexOf(e); c.remove?.(); c.parentNode = p; p.children.splice(i, 1, c); e.parentNode = null; },
      remove: () => { const p = e.parentNode; if (!p) return; p.children.splice(p.children.indexOf(e), 1); e.parentNode = null; },
      querySelectorAll: sel => { const out = []; const walk = n => n.children.forEach(c => { if (!c.isComment && match(c, sel)) out.push(c); walk(c); }); walk(e); return out; },
      querySelector: sel => e.querySelectorAll(sel)[0] || null,
    };
    return e;
  };
  const html = node('html'), body = node('body'); html.append(body);
  Object.assign(doc, { documentElement: html, body, createElement: node, createComment: () => node('#comment', true), getElementById: id => html.querySelectorAll('#' + id)[0] || null, querySelector: sel => html.querySelector(sel), querySelectorAll: sel => html.querySelectorAll(sel) });
  const mk = (cls, id) => { const e = node('div'); e.className = cls; if (id) e.id = id; return e; };
  const topbar = mk('topbar'), actions = mk('topbar-actions'), workspace = mk('workspace'), viewerGrid = mk('viewer-grid');
  const btn = (id, hidden) => { const b = node('button'); b.id = id; b.hidden = hidden; return b; };
  const tut = btn('tutorial-start-button', false), vrB = btn('vr-view-button', false), arB = btn('ar-view-button', true);
  actions.append(tut, vrB, arB); topbar.append(actions); workspace.append(viewerGrid); body.append(topbar, workspace);
  return { doc, topbar, actions, workspace, viewerGrid, tut, vrB, arB };
}

describe('the page layout (fake DOM)', () => {
  let launcherMod;
  beforeAll(async () => { installDomStub(); launcherMod = await importApp('event-launcher'); });
  const make = (overrides = {}) => {
    const dom = fakeDom(), g = { __vrlXrChecked: true, __vrlVolumeReady: true, ...overrides };
    const launcher = launcherMod.createEventLauncher({ doc: dom.doc, g, getVr: overrides.getVr || (async () => ({})) });
    return { ...dom, g, launcher };
  };
  it('with the mode on: the bar (under the top bar) holds the existing tutorial / VR / AR buttons and the status; the cards are in the area of the views; the views are NOT removed (CSS lays them out of the page)', () => {
    const t = make();
    expect(t.launcher.enable()).toBe(true);
    const bar = t.doc.getElementById('event-bar');
    expect(bar.parentNode).toBe(t.doc.body);
    expect(t.doc.body.children.indexOf(bar)).toBe(t.doc.body.children.indexOf(t.topbar) + 1); // right under the top bar
    expect(bar.children.map(c => c.id)).toEqual(['tutorial-start-button', 'vr-view-button', 'ar-view-button', 'event-status']);
    expect(bar.children[0]).toBe(t.tut); expect(bar.children[1]).toBe(t.vrB); expect(bar.children[2]).toBe(t.arB); // the same elements, moved: nothing re-created
    expect(t.arB.hidden).toBe(true); // their own show / enable state is not touched
    expect(t.actions.children.filter(c => !c.isComment).length).toBe(0);
    const cards = t.doc.getElementById('event-cards');
    expect(cards.parentNode.parentNode).toBe(t.workspace);
    expect(t.workspace.children).toContain(t.viewerGrid); // not removed from the page: the views and their state stay (display:none by style.css)
    expect(t.doc.documentElement.classList.contains('vrl-event-layout')).toBe(true);
    expect(t.g.__vrlEventLayout).toBe(true);
    expect(cards.querySelectorAll('[data-event-sample]').map(c => c.dataset.eventSample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5']);
    expect(cards.querySelectorAll('[data-event-level]').map(c => c.dataset.eventLevel)).toEqual(['lv0', 'lv1', 'lv2', 'lv3']);
    expect(cards.querySelectorAll('.event-card-license').length).toBe(1); // only the marmoset card
    expect(cards.querySelectorAll('.event-card-license')[0].parentNode.children[0].dataset.eventSample).toBe('sample5');
    expect(cards.querySelectorAll('.event-card-thumb').length).toBe(5);
    expect(t.doc.getElementById('event-status').textContent).toBe('');
  });
  it('mode off again: the buttons go back to their own place (before the others), the page is as it was; the late tutorial button too', () => {
    const t = make(); t.launcher.enable();
    t.launcher.disable();
    expect(t.actions.children.map(c => c.id)).toEqual(['tutorial-start-button', 'vr-view-button', 'ar-view-button']);
    expect(t.doc.getElementById('event-bar')).toBeNull(); expect(t.doc.getElementById('event-launcher')).toBeNull();
    expect(t.doc.documentElement.classList.contains('vrl-event-layout')).toBe(false); expect(t.g.__vrlEventLayout).toBe(false);
    // a tutorial button that was mounted while the page was on (it has no place of its own): before 「VRで見る」 afterwards
    const t2 = make(); t2.tut.remove(); t2.launcher.enable();
    const late = t2.doc.createElement('button'); late.id = 'tutorial-start-button'; t2.doc.getElementById('event-bar').insertBefore(late, t2.vrB);
    t2.launcher.disable();
    expect(t2.actions.children.map(c => c.id)).toEqual(['tutorial-start-button', 'vr-view-button', 'ar-view-button']);
  });
  it('nothing is opened or prepared by itself on page load', () => {
    const t = make(); const opened = []; t.doc.addEventListener('vrl-event-sample', e => opened.push(e.detail.sampleSet));
    t.launcher.enable();
    expect(opened).toEqual([]); expect(t.launcher.phase).toBe('');
    expect(SRC('event-launcher.js')).not.toMatch(/setTimeout\(\(\) => void press|onload|DOMContentLoaded/);
  });
  // a fake page: 'vrl-event-sample' is answered like app.js does (detail.done = a promise of the open)
  // record = false: the page has not recorded the standard open (standard-open.js) yet
  const page = (t, calls, { hold = false, record = true } = {}) => {
    const gate = { release: null };
    t.doc.addEventListener('vrl-event-sample', e => { calls.push('open:' + e.detail.sampleSet); t.g.__vrlOpenSample = e.detail.sampleSet; t.g.__vrlStandardOpen = record ? { id: e.detail.sampleSet, sig: 's' } : null; e.detail.done = hold ? new Promise(r => { gate.release = r; }) : Promise.resolve(); });
    return gate;
  };
  const fakeVr = (calls, { ready = { v: false }, failData = false } = {}) => ({ prepareVrData: async () => { calls.push('data'); if (failData) throw new Error('VR: open a DICOM series first'); return { key: 'k' }; }, prepareVrGpuOnce: async (P, mode) => { calls.push('gpu:' + mode); ready.v = true; }, vrReady: () => ready.v });
  it('a card press: loading -> preparing -> ready; it opens through vrl-event-sample, then prepares the VR data once in VR mode; the cards wait meanwhile', async () => {
    const calls = [], ready = { v: false }, t = make({ getVr: async () => fakeVr(calls, { ready }) }), gate = page(t, calls, { hold: true });
    t.launcher.enable();
    const card = t.doc.getElementById('event-cards').querySelector('[data-event-level="lv2"]');
    card.onclick();
    expect(t.launcher.phase).toBe('loading');
    expect(t.doc.getElementById('event-status').textContent).toBe('読み込み中…');
    expect(card.disabled).toBe(true); expect(t.doc.getElementById('event-cards').querySelector('[data-event-level="lv0"]').disabled).toBe(true);
    gate.release();
    await vi.waitFor(() => expect(t.launcher.phase).toBe('ready'), { timeout: 8000 });
    expect(calls).toEqual(['open:sample2', 'data', 'gpu:vr']);
    expect(t.doc.getElementById('event-status').textContent).toBe('準備完了');
    expect(t.doc.getElementById('event-status').dataset.state).toBe('ready');
    expect(card.classList.contains('is-selected')).toBe(true); expect(card.attrs['aria-pressed']).toBe('true');
    expect(card.disabled).toBe(false);
  }, 15000);
  it('the status goes back to nothing when the prepared data is gone (a session used it) or another dataset is opened', async () => {
    const calls = [], ready = { v: false }, t = make({ getVr: async () => fakeVr(calls, { ready }) }); page(t, calls);
    t.launcher.enable(); t.doc.getElementById('event-cards').querySelector('[data-event-level="lv1"]').onclick();
    await vi.waitFor(() => expect(t.launcher.phase).toBe('ready'), { timeout: 8000 });
    ready.v = false; t.launcher.refresh();
    expect(t.launcher.phase).toBe(''); expect(t.doc.getElementById('event-status').textContent).toBe('');
    ready.v = true; t.doc.getElementById('event-cards').querySelector('[data-event-level="lv1"]').onclick();
    await vi.waitFor(() => expect(t.launcher.phase).toBe('ready'), { timeout: 8000 });
    t.g.__vrlOpenSample = 'sample4'; t.doc.dispatchEvent(new CustomEvent('vrl-event-sample-open', { detail: { id: 'sample4' } }));
    expect(t.launcher.phase).toBe('');
  }, 20000);
  it('the preparation does not start until the standard-open record of the opened dataset is set, then it starts', async () => {
    const calls = [], t = make({ getVr: async () => fakeVr(calls) }); page(t, calls, { record: false });
    t.launcher.enable();
    t.doc.getElementById('event-cards').querySelector('[data-event-level="lv0"]').onclick();
    await vi.waitFor(() => expect(t.launcher.phase).toBe('loading'), { timeout: 8000 });
    await new Promise(r => setTimeout(r, 1800)); // the page is settled (settlePage), the record is not there: nothing is prepared
    expect(calls).toEqual(['open:sample4']);
    t.g.__vrlStandardOpen = { id: 'sample4', sig: 's' };
    await vi.waitFor(() => expect(t.launcher.phase).toBe('ready'), { timeout: 8000 });
    expect(calls).toEqual(['open:sample4', 'data', 'gpu:vr']);
  }, 20000);
  it('the VR module comes through the page: the launcher asks with the event vrl-vr-module (app.js answers with its loader)', async () => {
    const calls = [], dom = fakeDom(), g = { __vrlXrChecked: true, __vrlVolumeReady: true };
    const launcher = launcherMod.createEventLauncher({ doc: dom.doc, g }); // no getVr given: the default route
    const t = { doc: dom.doc, g }; page(t, calls);
    let asked = 0; dom.doc.addEventListener('vrl-vr-module', e => { asked++; e.detail.done = Promise.resolve(fakeVr(calls)); });
    launcher.enable(); dom.doc.getElementById('event-cards').querySelector('[data-event-level="lv0"]').onclick();
    await vi.waitFor(() => expect(launcher.phase).toBe('ready'), { timeout: 8000 });
    expect(asked).toBe(1); expect(calls).toEqual(['open:sample4', 'data', 'gpu:vr']);
  }, 15000);
  it('an XR session that starts while the card is still opening stops the flow: no prepareVrData / prepareVrGpuOnce, the status goes back to nothing', async () => {
    const calls = [], t = make({ getVr: async () => fakeVr(calls) }), gate = page(t, calls, { hold: true });
    t.launcher.enable();
    t.doc.getElementById('event-cards').querySelector('[data-event-level="lv1"]').onclick();
    expect(t.launcher.phase).toBe('loading');
    t.doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind: 'vr-start' } }));
    expect(t.launcher.phase).toBe('');
    gate.release();
    await new Promise(r => setTimeout(r, 1800));
    expect(calls).toEqual(['open:sample3']); expect(t.launcher.phase).toBe('');
  }, 15000);
  it('an AR session that starts while the VR module is loading stops the flow before prepareVrData (no second preparation during the session)', async () => {
    const calls = []; let release; const slow = new Promise(r => { release = r; });
    const t = make({ getVr: async () => { await slow; return fakeVr(calls); } }); page(t, calls);
    t.launcher.enable();
    t.doc.getElementById('event-cards').querySelector('[data-event-level="lv1"]').onclick();
    await vi.waitFor(() => expect(t.launcher.phase).toBe('preparing'), { timeout: 8000 });
    t.doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind: 'ar-start' } }));
    expect(t.launcher.phase).toBe('');
    release(); await new Promise(r => setTimeout(r, 300));
    expect(calls).toEqual(['open:sample3']); expect(t.launcher.phase).toBe('');
  }, 15000);
  it('a press while loading does nothing: one open, one preparation', async () => {
    const calls = [], t = make({ getVr: async () => fakeVr(calls) }), gate = page(t, calls, { hold: true });
    t.launcher.enable();
    const cards = t.doc.getElementById('event-cards');
    cards.querySelector('[data-event-level="lv1"]').onclick();
    cards.querySelector('[data-event-level="lv3"]').onclick(); cards.querySelector('[data-event-level="lv1"]').onclick();
    expect(calls).toEqual(['open:sample3']);
    gate.release();
    await vi.waitFor(() => expect(t.launcher.phase).toBe('ready'), { timeout: 8000 });
    expect(calls).toEqual(['open:sample3', 'data', 'gpu:vr']);
  }, 15000);
  it('no VR / AR in this browser: the data opens, nothing is prepared, no "ready" is claimed', async () => {
    const calls = [], t = make({ getVr: async () => fakeVr(calls) }); page(t, calls);
    t.vrB.hidden = true; t.arB.hidden = true; t.launcher.enable();
    t.doc.getElementById('event-cards').querySelector('[data-event-level="lv0"]').onclick();
    await vi.waitFor(() => expect(calls).toEqual(['open:sample4']), { timeout: 8000 });
    await vi.waitFor(() => expect(t.launcher.phase).toBe(''), { timeout: 8000 });
    expect(calls).toEqual(['open:sample4']);
  }, 15000);
  it('a preparation that fails leaves no status and the cards usable (the VR button prepares as usual)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = [], t = make({ getVr: async () => fakeVr(calls, { failData: true }) }); page(t, calls);
    t.launcher.enable(); const card = t.doc.getElementById('event-cards').querySelector('[data-event-sample="sample5"]');
    card.onclick();
    await vi.waitFor(() => expect(calls).toEqual(['open:sample5', 'data']), { timeout: 8000 });
    await vi.waitFor(() => expect(t.launcher.phase).toBe(''), { timeout: 8000 });
    expect(card.disabled).toBe(false); expect(warn).toHaveBeenCalled(); warn.mockRestore();
  }, 15000);
  it('「チュートリアルを始める」: its begin event opens Lv0 (sample4) and prepares, with no card pressed', async () => {
    const calls = [], t = make({ getVr: async () => fakeVr(calls) }); page(t, calls);
    t.launcher.enable();
    t.doc.dispatchEvent(new CustomEvent('vrl-tutorial-begin'));
    await vi.waitFor(() => expect(t.launcher.phase).toBe('ready'), { timeout: 8000 });
    expect(calls).toEqual(['open:sample4', 'data', 'gpu:vr']);
    const off = make(); const opened = []; off.doc.addEventListener('vrl-event-sample', e => opened.push(e)); // layout off: nothing opens
    off.doc.dispatchEvent(new CustomEvent('vrl-tutorial-begin')); expect(opened).toEqual([]);
  }, 15000);
  it('the begin event and the tutorial are wired in the sources: tutorial-ui.js sends it after the existing begin path, the page opens Lv0 without restarting the tutorial a second time', () => {
    expect(SRC('tutorial-ui.js')).toContain("intro.start();try{document.dispatchEvent(new CustomEvent('vrl-tutorial-begin'))}catch{}}");
    const ui = SRC('event-launcher.js');
    expect(ui).toContain("const onTutorialBegin = () => { const lv0 = EVENT_DATASETS.find(d => d.id === 'lv0'); if (on && lv0) void press(lv0, { tutorial: true }); };");
    expect(ui).toContain("if (!tutorial && d.id === 'lv0' && tutorialUiActive())");
  });
});

describe('the views are not drawn while the page is on, and the layout is not an overlay (static)', () => {
  it('style.css lays the views and their bar out of the page (display:none, no cover); the event bar is a grid row of its own that never scrolls, the cards scroll by themselves', () => {
    const css = SRC('style.css');
    expect(css).toContain('html.vrl-event-layout .viewer-grid,\nhtml.vrl-event-layout .ipad-workspace-toolbar{display:none!important}');
    const block = css.slice(css.indexOf('/* the 体験会モード page'), css.indexOf('/* 設定 > デバッグ > テスト機能'));
    expect(block).not.toMatch(/position:\s*fixed/); // not an overlay: nothing is laid over the normal UI (the only absolute box is the picture inside its own frame)
    expect(block.match(/position:\s*absolute/g)?.length).toBe(1); expect(block).toContain('.event-card-thumb img{position:absolute;inset:0');
    expect(block).not.toMatch(/z-index/);
    expect(block).toContain('html.vrl-event-layout .app-shell{grid-template-rows:auto auto minmax(0,1fr) auto}');
    expect(block).toMatch(/\.event-cards\{[^}]*overflow-y:auto/);
    expect(block).toContain('aspect-ratio:16/9');
    expect(block).toMatch(/\.event-bar button\{min-height:\d{2}px/); // big targets for the laser pointer
  });
  it('the 2D paint and the 3D loop skip drawing while it is on: renderPlane / the section paint / the per-slice filter path (mpr-render.js); the 3D loop already returns for a view with no size (app.js)', () => {
    const mpr = SRC('mpr-render.js');
    expect(mpr).toContain("const eventLayoutOn=()=>globalThis.__vrlEventLayout===true;");
    expect(mpr).toContain('if(!volume||revision!==planeRenderRevision[p])return;\n if(eventLayoutOn())return;');
    expect(mpr).toContain('if(!immediate&&perSliceFilteredActive()&&!eventLayoutOn()){');
    expect(mpr).toContain("if(eventLayoutOn())return; // not drawn (see renderPlane)");
    expect(SRC('app.js')).toContain('if(viewport.clientWidth<8||viewport.clientHeight<8)return;sceneState.needsRender=false;');
    expect(SRC('app.js')).toContain("document.addEventListener('vrl-event-layout',e=>{if(e.detail?.on)return;"); // switched off: sizes and paints come back
  });
  it('the page volume object is kept (MedicalVolumeRenderer): the layout code never touches the 3D renderer, the volume or the DOM of the views', () => {
    const ui = SRC('event-launcher.js').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(ui).not.toMatch(/viewer-grid|viewport-3d|medicalVolume|MedicalVolumeRenderer|sceneState/);
    expect(SRC('event-mode-ui.js')).not.toMatch(/medicalVolume|sceneState/);
  });
  it('vr-view.js prepareVrGpuOnce is a no-op (resolved null) while an XR session runs, before it touches anything', () => {
    const vr = SRC('vr-view.js');
    const i = vr.indexOf("export function prepareVrGpuOnce(P,mode='vr'){");
    expect(i).toBeGreaterThan(0);
    const body = vr.slice(i, vr.indexOf('\n}\n', i)).replace(/\/\/.*$/gm, '');
    expect(body.split('\n')[1].trim()).toContain('if(running)return Promise.resolve(null);');
    expect(body.indexOf('if(running)')).toBeLessThan(body.indexOf('prepareVrGpu(P,mode)'));
    expect(body).not.toMatch(/initialVrModes|P\.combo|P\.cls4/);
  });
  it('event mode off: the layout code is idle (enable only from the switch; no class, no flag, no element until then)', () => {
    const ui = SRC('event-mode-ui.js');
    expect(ui).toContain("if(on&&!panel)mount();else if(!on&&panel){");
    expect(ui).toContain('if(!launcher.enable())return;');
  });
});
