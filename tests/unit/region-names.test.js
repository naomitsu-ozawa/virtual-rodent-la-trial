import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import * as N from '../../docs/region-name.js';

// analysis region name / Atlas ID (saved in project.json analysis.regions[]; no projectVersion change)
installDomStub();
let R, O, ST, D;
beforeAll(async () => { R = await importApp('analysis-results'); O = await importApp('analysis-ops'); ST = await importApp('state'); D = await importApp('data-load'); });

describe('name normalisation', () => {
  it('strips control characters and clamps to 40 characters', () => {
    expect(N.normalizeRegionName('a\u0000b\u0007c\nd\te\u007f')).toBe('abcde');
    expect(N.normalizeRegionName('x'.repeat(100))).toHaveLength(40);
    expect(N.normalizeRegionName('  \u0001 眼球 \u0002 ')).toBe('眼球');
    expect(N.normalizeRegionName(5)).toBe('');
    expect(N.normalizeRegionName(null)).toBe('');
  });
  it('atlasId must be a finite number', () => {
    expect(N.normalizeRegionAtlasId(1100)).toBe(1100);
    expect(N.normalizeRegionAtlasId('1100')).toBeUndefined();
    expect(N.normalizeRegionAtlasId(NaN)).toBeUndefined();
  });
});

describe('string label -> name (backward compatibility)', () => {
  it('a string label becomes the name (clamped, stripped); an object label is never a name', () => {
    expect(N.regionNameFromEntry({ label: 'Atlas ID 1100' })).toBe('Atlas ID 1100');
    expect(N.regionNameFromEntry({ label: 'L'.repeat(60) + '\u0000' })).toHaveLength(40);
    expect(N.regionNameFromEntry({ label: { anchor: { i: 1, j: 2, k: 3 } } })).toBe('');
    expect(N.regionNameFromEntry({ name: 'A', label: 'B' })).toBe('A');
    expect(N.regionNameFromEntry({})).toBe('');
  });
  it('the pin logic does not take a string label', async () => {
    const { normalizeAnalysisLabel } = await importApp('analysis-label');
    expect(normalizeAnalysisLabel('Atlas ID 1100')).toBeNull();
    expect(normalizeAnalysisLabel({ anchor: { i: 1, j: 2, k: 3 } })).toEqual({ anchor: { i: 1, j: 2, k: 3 } });
  });
});

describe('display name rule', () => {
  it('name, else "ID <atlasId>", else the default', () => {
    expect(R.analysisRegionName({ id: 3, name: '眼球', atlasId: 7 })).toBe('眼球');
    expect(R.analysisRegionName({ id: 3, atlasId: 1100 })).toBe('ID 1100');
    expect(R.analysisRegionName({ id: 3, name: '', atlasId: 0 })).toBe('ID 0');
    const plain = R.analysisRegionName({ id: 3 });
    expect(plain).toMatch(/3$/); expect(plain).not.toMatch(/^ID /);
    expect(R.analysisRegionName({ id: 4, merged: true })).not.toBe(plain);
    expect(N.regionCustomName({ id: 3 })).toBe('');
  });
});

describe('pure display-name rule (docs/region-name.js)', () => {
  it('name, else ID <atlasId>, else the fallback (string or function)', () => {
    expect(N.regionDisplayName({ name: 'X' }, 'dflt')).toBe('X');
    expect(N.regionDisplayName({ atlasId: 5 }, 'dflt')).toBe('ID 5');
    expect(N.regionDisplayName({ id: 2 }, 'dflt')).toBe('dflt');
    expect(N.regionDisplayName({ id: 2 }, r => 'R' + r.id)).toBe('R2');
  });
});

describe('save / restore round trip', () => {
  const runs = [[1, 0, 4], [1, 0, 4]];
  it('name and atlasId are written to analysis.regions[] and read back; old regions have neither', async () => {
    ST.setActiveSeries({ id: 's1', slices: [{}, {}], rows: 4, columns: 4 });
    ST.setAnalysisRegions([]); ST.setSceneState({ medicalVolume: { active: true } }); ST.setThreeRenderMode('volume'); // GPU volume view: no mesh is built
    const vol = { columns: 4, rows: 4, slices: 2, spacing: [1, 1, 1] };
    await O.restoreAnalysisRegions([
      { key: 'contrast', segmentKeys: ['contrast'], color: 0xff0000, visible: true, name: 'Atlas ID 1100', atlasId: 1100, runsBySlice: runs },
      { key: 'contrast', segmentKeys: ['contrast'], color: 0x00ff00, visible: true, runsBySlice: runs },
    ], vol);
    const saved = JSON.parse(JSON.stringify(O.analysisRegionsForProject()));
    expect(saved[0]).toMatchObject({ name: 'Atlas ID 1100', atlasId: 1100 });
    expect('name' in saved[1]).toBe(false); expect('atlasId' in saved[1]).toBe(false);
    const snap = O.snapshotAnalysisRegionsForSegment('contrast');
    expect(snap[0]).toMatchObject({ name: 'Atlas ID 1100', atlasId: 1100 });
    expect(snap[1].name).toBeUndefined();
    ST.setAnalysisRegions([]); ST.setSceneState(null); ST.setThreeRenderMode('surface');
  });
  it('atlasProvenance is kept and written back unchanged', () => {
    const prov = { source: 'allen', version: 3, nested: { a: [1, 2] } };
    O.setAtlasProvenance(prov);
    ST.setActiveSeries({ id: 's1', slices: [{}, {}], rows: 4, columns: 4 });
    expect(D.gatherProject().project.atlasProvenance).toEqual(prov);
    O.setAtlasProvenance(undefined);
    expect('atlasProvenance' in D.gatherProject().project).toBe(false);
  });
});

describe('static wiring', () => {
  const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('VR label uses the shared rule; data-load reads name / atlasId and matches by atlasId', () => {
    const vr = read('vr-view.js'); expect(vr).toContain('vrRegionName(r)'); expect(vr).not.toContain('analysis-results.js');
    expect(vr.match(/vrRegionName\(r\)/g).length).toBe(3);
    const dl = read('data-load.js');
    expect(dl).toContain('regionNameFromEntry(e)'); expect(dl).toContain('e.atlasId===r.atlasId');
    expect(read('analysis-ops.js')).toContain('...regionExtras(r)');
  });
});
