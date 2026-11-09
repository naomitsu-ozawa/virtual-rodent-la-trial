// 体験会モード page (event-launcher.js): the pure parts - no DOM, no THREE, unit-tested (tests/unit/event-launcher.test.js).
//  - eventCards: the card model, built from ONE list (event-mode.js EVENT_DATASETS) + the license notices (sample-credits.js)
//  - eventStatus / EVENT_STATUS_KEYS: the status text of the top bar (読み込み中… / 準備中… / 準備完了)
//  - openAndPrepare: the order after a card press (open the data, wait until the page is quiet, prepare the VR data)
//  - createInflight: a run that is already in flight is shared, never started twice
import { EVENT_DATASETS } from './event-mode.js?v=20261109-build697';
import { sampleCredit } from './sample-credits.js?v=20261109-build697';

export function eventCards(datasets = EVENT_DATASETS, creditOf = sampleCredit) {
  return datasets.map(d => {
    const c = creditOf(d.sample);
    return {
      id: d.id, sample: d.sample, kind: d.kind, lv: d.lv, nameKey: d.nameKey, missionKey: d.missionKey,
      levelAttr: d.kind === 'level' ? d.id : null,
      thumbFile: 'thumb.webp',
      license: c ? { name: c.licenseName, url: c.licenseUrl } : null,
    };
  });
}

// the three states of the status text; '' = nothing to say (no dataset was chosen yet, or it is not prepared any more)
export const EVENT_STATUS_KEYS = Object.freeze({ loading: 'evStLoading', preparing: 'evStPreparing', ready: 'evStReady' });
export function eventStatus({ loading = false, preparing = false, ready = false } = {}) {
  return loading ? 'loading' : preparing ? 'preparing' : ready ? 'ready' : '';
}

// A card press: open the data, wait until the page is quiet, prepare the VR data. Every step is injected (the page's startSample, the settle gate, vr-view.js).
// isStale() = another card was pressed meanwhile: the old run stops quietly. Returns 'ready' | 'stale'; a step that throws rejects (the caller shows no status).
export async function openAndPrepare({ open, settle, prepare, isStale = () => false, onPhase = () => {} }) {
  onPhase('loading');
  await open();
  if (isStale()) return 'stale';
  await settle();
  if (isStale()) return 'stale';
  onPhase('preparing');
  await prepare();
  if (isStale()) return 'stale';
  onPhase('ready');
  return 'ready';
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
