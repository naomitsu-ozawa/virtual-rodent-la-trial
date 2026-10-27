// 「体験会用データを準備」 (設定 > キャッシュ): the four practice levels are opened one after the other on the page with their built-in project's standard settings, and the finished VR data of each
// is built and saved to the device (the same keys as VR entry / a data switch would make, so VR reads them later), then marked as the protected standard entries (vr-prep-cache.js protectedKeys).
// Pure orchestration (no DOM, no GL): everything that touches the page is injected, so the order and the reports are unit-tested (tests/unit/event-prepare.test.js).
//   io.isCached(sample)  -> boolean   the level's standard entries are all on the device already
//   io.open(sample)      -> Promise   the level is open on the page, its project applied, the page quiet (the previous level's data is released by the page itself)
//   io.build(sample)     -> Promise<{ok, why?}>   the VR data is built and saved completely (no save is cut), ok = the standard entries are on the device
//   io.release()         the VR side lets go of the data (one level in memory at a time)
//   io.restore()         -> Promise   the level that was open before is opened again
// States of a level: wait, building, saved (built and saved now), cached (it was saved already: skipped), failed (why: 'capacity' | 'failed' | 'error').
export const PREPARE_STATES = ['wait', 'building', 'saved', 'cached', 'failed'];

export async function prepareEventLevels({ levels, io, onStatus = () => {}, isCancelled = () => false }) {
  const results = levels.map(l => ({ id: l.id, lv: l.lv, sample: l.sample, state: 'wait', why: '' }));
  const set = (r, state, why = '') => { r.state = state; r.why = why; try { onStatus(results.map(x => ({ ...x }))); } catch { /* none */ } };
  onStatus(results.map(x => ({ ...x })));
  try {
    for (const r of results) {
      if (isCancelled()) break;
      try {
        if (await io.isCached(r.sample)) { set(r, 'cached'); continue; }
        set(r, 'building');
        await io.open(r.sample);
        const out = await io.build(r.sample);
        set(r, out && out.ok ? 'saved' : 'failed', out && out.ok ? '' : (out && out.why) || 'failed');
      } catch (e) {
        set(r, 'failed', 'error'); console.warn('Event data preparation: a level failed', r.id, e);
      } finally {
        try { io.release(); } catch { /* none */ }
      }
    }
  } finally {
    try { await io.restore(); } catch (e) { console.warn('Event data preparation: the previous level was not reopened', e); }
  }
  const failed = results.filter(r => r.state === 'failed');
  return { results, ok: failed.length === 0 && results.every(r => r.state === 'saved' || r.state === 'cached'), failed };
}
