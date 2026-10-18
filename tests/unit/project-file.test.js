import { describe, it, expect } from 'vitest';
import { datasetFingerprint, compareFingerprints, encodeRuns, decodeRuns, packProject, unpackProject, PROJECT_VERSION } from '../../docs/project-file.js';
import { zipSync, strToU8 } from 'fflate';

const series = { id: 's::1', description: 'Mouse CT', modality: 'CT', columns: 8, rows: 6, spacingX: 0.05, spacingY: 0.05, spacingZ: 0.1, slices: [{ studyUid: 's', seriesUid: '1' }, {}, {}] };
const dims = { slices: 3, columns: 8, rows: 6 };
const runs = (...t) => new Uint32Array(t);

describe('dataset fingerprint', () => {
  it('matches the same series and rejects different geometry', () => {
    const fp = datasetFingerprint(series);
    expect(fp).toMatchObject({ seriesUid: '1', columns: 8, rows: 6, slices: 3, spacing: [0.05, 0.05, 0.1] });
    expect(compareFingerprints(fp, datasetFingerprint(series)).ok).toBe(true);
    expect(compareFingerprints(fp, { ...fp, slices: 4 }).issues).toEqual(['slices']);
    expect(compareFingerprints(fp, { ...fp, seriesUid: '2' }).issues).toContain('seriesUid');
    expect(compareFingerprints(fp, { ...fp, spacing: [0.05, 0.05, 0.2] }).issues).toEqual(['spacing']);
  });
});

describe('edit runs binary', () => {
  it('round-trips, keeping empty slices empty', () => {
    const src = [runs(0, 1, 3, 2, 0, 7), null, runs(5, 4, 4)];
    const back = decodeRuns(encodeRuns(src, 3), dims);
    expect(back.map(r => r && [...r])).toEqual([[0, 1, 3, 2, 0, 7], null, [5, 4, 4]]);
  });
  it('rejects wrong slice count, out-of-bounds runs and garbage', () => {
    expect(() => decodeRuns(encodeRuns([runs(0, 0, 1)], 1), dims)).toThrow(/slices/);
    expect(() => decodeRuns(encodeRuns([runs(0, 0, 8), null, null], 3), dims)).toThrow(/bounds/);
    expect(() => decodeRuns(encodeRuns([runs(6, 0, 1), null, null], 3), dims)).toThrow(/bounds/);
    expect(() => decodeRuns(new Uint8Array(12), dims)).toThrow(/magic/);
  });
});

describe('project zip', () => {
  it('packs and unpacks project.json with binaries', () => {
    const bin = encodeRuns([runs(1, 2, 3), null, null], 3);
    const bytes = packProject({ dataset: datasetFingerprint(series), filters: { order: [{ key: 'gaussian', params: { strength: '1.5' } }] } }, { 'edits/bone-exclude.bin': bin });
    const { project, files } = unpackProject(bytes);
    expect(project.version).toBe(PROJECT_VERSION);
    expect(project.filters.order[0]).toEqual({ key: 'gaussian', params: { strength: '1.5' } });
    expect([...decodeRuns(files['edits/bone-exclude.bin'], dims)[0]]).toEqual([1, 2, 3]);
  });
  it('rejects non-projects, other formats and newer versions', () => {
    expect(() => unpackProject(new Uint8Array([1, 2, 3]))).toThrow(/zip/);
    expect(() => unpackProject(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/project.json/);
    expect(() => unpackProject(zipSync({ 'project.json': strToU8('{"format":"other","version":1}') }))).toThrow(/Virtual Rodent Lab/);
    expect(() => unpackProject(zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'virtual-rodent-lab-project', version: PROJECT_VERSION + 1 })) }))).toThrow(/newer/);
  });
});

describe('project files saved or unpacked by other apps', () => {
  it('recognises .vrlab and Safari-renamed .zip archives', async () => {
    const { isProjectArchiveName } = await import('../../docs/project-file.js');
    expect(isProjectArchiveName('mouse_2026-09-26.vrlab')).toBe(true);
    expect(isProjectArchiveName('mouse_2026-09-26.vrlab.zip')).toBe(true);
    expect(isProjectArchiveName('mouse.zip')).toBe(true);
    expect(isProjectArchiveName('slice001.dcm')).toBe(false);
  });

  it('rebuilds a project from an extracted folder (iOS Files app)', async () => {
    const { projectFromEntries } = await import('../../docs/project-file.js');
    const bin = encodeRuns([runs(1, 2, 3), null, null], 3);
    const json = strToU8(JSON.stringify({ format: 'virtual-rodent-lab-project', version: 1, dataset: datasetFingerprint(series), edits: { bone: { exclude: 'edits/bone-exclude.bin' } } }));
    const { project, files } = projectFromEntries([
      { path: 'DICOM/mouse.vrlab/project.json', bytes: json },
      { path: 'DICOM/mouse.vrlab/edits/bone-exclude.bin', bytes: bin },
      { path: 'DICOM/slice001.dcm', bytes: new Uint8Array(4) },
    ]);
    expect(project.edits.bone.exclude).toBe('edits/bone-exclude.bin');
    expect([...decodeRuns(files['edits/bone-exclude.bin'], dims)[0]]).toEqual([1, 2, 3]);
    expect(files['slice001.dcm']).toBeUndefined();
  });

  it('rejects folders without a valid project.json', async () => {
    const { projectFromEntries } = await import('../../docs/project-file.js');
    expect(() => projectFromEntries([{ path: 'a/x.bin', bytes: new Uint8Array(1) }])).toThrow(/project.json/);
    expect(() => projectFromEntries([{ path: 'a/project.json', bytes: strToU8('{"format":"x","version":1}') }])).toThrow(/Virtual Rodent Lab/);
  });
});
