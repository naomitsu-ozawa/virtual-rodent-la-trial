import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openVolumeCache, pruneOtherFilterSettings } from '../../docs/gpu-volume-cache.js';

const fp = id => ({ seriesId: id, studyUid: 's' + id, seriesUid: 'u' + id, description: 'd', modality: 'CT', columns: 4, rows: 4, slices: 1 });

async function put(cache, key, info) {
  const w = await cache.begin(key, { slices: 1, bytesPerSlice: 4, info });
  await w.write(0, new Uint8Array(4)); await w.commit();
}
const keys = async c => (await c.list()).map(e => e.key).sort();

describe('auto-prune with object datasets read back from IndexedDB', () => {
  it('drops old filter settings of the same dataset (volume and segment-runs), keeps other datasets', async () => {
    const cache = await openVolumeCache({ indexedDB: new IDBFactory() });
    await put(cache, 'vOld', { kind: 'volume', dataset: fp('A'), plan: '512', filter: 'g0.5' });
    await put(cache, 'vOther', { kind: 'volume', dataset: fp('B'), plan: '512', filter: 'g0.5' });
    await put(cache, 'rOld', { kind: 'segment-runs', dataset: fp('A'), filter: 'g0.5' });
    await put(cache, 'rOther', { kind: 'segment-runs', dataset: fp('B'), filter: 'g0.5' });
    await put(cache, 'pOld', { kind: 'filtered-plane', dataset: JSON.stringify(fp('A')), filter: 'g0.5' });
    await put(cache, 'vCur', { kind: 'volume', dataset: fp('A'), plan: '512', filter: 'g0.6' });
    await pruneOtherFilterSettings(cache, { kind: 'volume', dataset: fp('A'), plan: '512', filter: 'g0.6' }, 'vCur');
    await pruneOtherFilterSettings(cache, { kind: 'segment-runs', dataset: fp('A'), filter: 'g0.6' }, 'rCur');
    expect(await keys(cache)).toEqual(['pOld', 'rOther', 'vCur', 'vOther']);
    // a new plane for dataset A (string id) also matches the same dataset
    await pruneOtherFilterSettings(cache, { kind: 'filtered-plane', dataset: JSON.stringify(fp('A')), filter: 'g0.6' }, 'pCur');
    expect(await keys(cache)).toEqual(['rOther', 'vCur', 'vOther']);
  });
});
