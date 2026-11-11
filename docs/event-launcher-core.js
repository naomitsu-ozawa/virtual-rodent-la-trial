// 体験会モード page (event-launcher.js): the pure parts - no DOM, no THREE, unit-tested (tests/unit/event-launcher.test.js).
//  - eventCards: the card model, built from ONE list (event-mode.js EVENT_DATASETS) + the credit of each dataset (its sample.json, through sample-registry.js)
//  - eventStatus / EVENT_STATUS_KEYS: the status text of the top bar (読み込み中… / 準備中… / 準備完了)
//  - openAndPrepare: the order after a card press (open the data, wait until the page is quiet, wait for the standard-open record, prepare the VR data)
//  - waitForStandardOpen: the bounded wait for the record standard-open.js sets (so the prepared entry is marked standard)
//  - createInflight: a run that is already in flight is shared, never started twice
import { EVENT_DATASETS } from './event-mode.js?v=20261111-build716';
import { sampleCredit } from './sample-registry.js?v=20261111-build716';
import { isSampleId } from './sample-sets.js?v=20261111-build716';

// One card per dataset of the list. thumb = where the 16:9 picture would be (docs/demo/<sample>/thumb.webp; the page shows an empty frame when the file is not there).
// credit = the credit of the dataset when its sample.json has one (credit / license / changes / terms), else null - the datasets without one show no license line.
export function eventCards(datasets = EVENT_DATASETS, creditOf = sampleCredit) {
  return datasets.map(d => {
    const c = creditOf(d.sample);
    return {
      id: d.id, sample: d.sample, kind: d.kind, lv: d.lv, nameKey: d.nameKey, missionKey: d.missionKey,
      levelAttr: d.kind === 'level' ? d.id : null,
      thumbFile: 'thumb.webp',
      credit: c,
    };
  });
}

// the three states of the status text; '' = nothing to say (no dataset was chosen yet, or it is not prepared any more)
export const EVENT_STATUS_KEYS = Object.freeze({ loading: 'evStLoading', preparing: 'evStPreparing', ready: 'evStReady' });
export function eventStatus({ loading = false, preparing = false, ready = false } = {}) {
  return loading ? 'loading' : preparing ? 'preparing' : ready ? 'ready' : '';
}

// A card press: open the data, wait until the page is quiet, wait for the standard-open record, prepare the VR data. Every step is injected (the page's startSample, the settle gate, vr-view.js).
// isStale() = another card was pressed meanwhile: the old run stops quietly. Returns 'ready' | 'stale'; a step that throws rejects (the caller shows no status).
export async function openAndPrepare({ open, settle, standard = async () => {}, prepare, isStale = () => false, onPhase = () => {} }) {
  onPhase('loading');
  await open();
  if (isStale()) return 'stale';
  await settle();
  await standard(); // prepareVrData reads the record when it stores the entry: it must be set before (never throws, bounded)
  if (isStale()) return 'stale';
  onPhase('preparing');
  await prepare();
  if (isStale()) return 'stale';
  onPhase('ready');
  return 'ready';
}

// standard-open.js records (__vrlStandardOpen = {id, sig}) a practice dataset that was opened with its standard settings; it has its OWN quiet gate (same conditions as settlePage), so the record can come a moment
// after the page settled. The prepared VR data is marked standard only if the record is there when it is stored, so the preparation waits for it: no event exists for it, therefore a poll every pollMs (sleeping, not busy),
// at most timeoutMs (default 10 s: the gate needs 1.2 s of a quiet page + one 200 ms poll). Not a practice dataset (no record is ever made) -> returns at once. Returns true when the record of `sample` is there; false after
// the bound or when stop() says the run is stale (the preparation then goes on as it did before: the entry just is not standard).
export const isPracticeSample = isSampleId; // the ONE folder name rule (sample-sets.js)
export async function waitForStandardOpen({ sample, read, stop = () => false, timeoutMs = 10000, pollMs = 100, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!isPracticeSample(sample)) return false;
  const has = () => { try { return read()?.id === sample; } catch { return false; } };
  for (let waited = 0; ; waited += pollMs) {
    if (has()) return true;
    if (waited >= timeoutMs || stop()) return false;
    await sleep(pollMs);
  }
}

// run(key, fn): while a run with this key is in flight the same promise is returned (fn is not started a second time); a finished run is forgotten
export function createInflight() {
  const m = new Map();
  return {
    run(key, fn) {
      if (m.has(key)) return m.get(key);
      const p = Promise.resolve().then(fn).finally(() => { if (m.get(key) === p) m.delete(key); });
      m.set(key, p);
      return p;
    },
    has: key => m.has(key),
  };
}
