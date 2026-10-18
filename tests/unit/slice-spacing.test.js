import { describe, it, expect } from 'vitest';
import { groupSeries, expandParsedFrames, parseDicomHeader, parsedSliceMeta } from '../../docs/dicom.js';
import { analyzeSliceSpacing, spacingWarningText, spacingCheckForProject, sliceNormal, SPACING_THRESHOLDS } from '../../docs/slice-spacing.js';
import { packProject, unpackProject, compareFingerprints, datasetFingerprint, legacySpacingUpgrade, legacySpacingPrompt, resolveProjectMatch } from '../../docs/project-file.js';
import { makeCtSlice, asFile } from '../helpers/synthetic-dicom.js';

// synthetic slice metas (no real data); z positions in mm
const meta = (z, extra = {}) => ({ studyUid: 's', seriesUid: 'u', description: 'syn', modality: 'CT', rows: 4, columns: 4, bits: 16, bitsStored: 16, signed: 0, slope: 1, intercept: 0, pixelSpacing: [0.2, 0.1], thickness: 0.5, spacingBetween: null, pos: [0, 0, z], instance: 1, ...extra });
const series = (zs, extra) => groupSeries(zs.map(z => meta(z, extra)))[0];
const volumeMm3 = (s, voxels) => voxels * s.spacingX * s.spacingY * s.spacingZ; // same formula as analysis-ops

describe('slice spacing check', () => {
  it('uniform spacing: no warning, spacing = span / (N-1)', () => {
    const s = series([0, 0.5, 1, 1.5, 2]);
    expect(s.spacingCheck).toMatchObject({ warn: false, missing: 0, duplicates: 0, nonUniform: false, basis: 'span', used: 0.5, method: 'z' });
    expect(spacingWarningText(s.spacingCheck)).toBeNull();
    expect(s.spacingZ).toBe(0.5);
  });

  it('exactly uniform data gives the identical volume as the previous first-two-slices rule', () => {
    const zs = [10, 10.5, 11, 11.5, 12]; // exactly representable steps
    const s = series(zs);
    const before = Math.abs(zs[1] - zs[0]); // previous implementation
    expect(s.spacingZ).toBe(before);
    expect(volumeMm3(s, 1234)).toBe(1234 * 0.1 * 0.2 * before);
    // decimal positions: the same to float precision
    const t = series([10, 10.35, 10.7, 11.05, 11.4]);
    expect(t.spacingZ).toBeCloseTo(0.35, 12);
    expect(t.spacingCheck.legacyZ).toBe(Math.abs(10.35 - 10));
  });

  it('detects one missing slice and uses the gap-corrected fit', () => {
    const s = series([0, 0.5, 1, 2, 2.5, 3]);
    const c = s.spacingCheck;
    expect(c).toMatchObject({ warn: true, missing: 1, duplicates: 0, basis: 'fit', medianGap: 0.5 });
    expect(c.missingGaps).toEqual([{ index: 2, gap: 1, missing: 1 }]);
    expect(s.spacingZ).toBe(0.5);
    const w = spacingWarningText(c);
    expect(w.ja).toContain('抜け 1 枚');
    expect(w.ja).toContain('抜けを補正したフィット間隔 0.5 mm');
    expect(w.en).toContain('1 missing');
  });

  it('counts several missing slices in one gap', () => {
    expect(series([0, 1, 2, 5, 6]).spacingCheck.missing).toBe(2);
  });

  it('excludes a duplicate slice (smaller InstanceNumber stays) and says so', () => {
    const zs = [0, 0.5, 0.5, 1, 1.5], inst = [1, 2, 3, 4, 5];
    const s = groupSeries(zs.map((z, i) => meta(z, { instance: inst[i] })))[0];
    expect(s.slices).toHaveLength(4);
    expect(s.slices.map(x => x.instance)).toEqual([1, 2, 4, 5]);
    expect(s.spacingCheck).toMatchObject({ warn: true, duplicates: 1, duplicatesExcluded: 1, missing: 0, basis: 'span' });
    expect(s.spacingZ).toBe(0.5);
    const w = spacingWarningText(s.spacingCheck);
    expect(w.ja).toContain('重複 1 枚を除外しました');
    expect(w.en).toContain('Excluded 1 duplicate slice(s)');
    // voxel count of the volume follows the kept slices
    expect(s.slices.length * s.rows * s.columns).toBe(4 * 4 * 4);
  });

  it('keeps the smaller InstanceNumber even when it was read later; ties keep read order', () => {
    const a = groupSeries([meta(0, { instance: 9 }), meta(0, { instance: 3 }), meta(0.5, { instance: 4 }), meta(1, { instance: 5 })])[0];
    expect(a.slices.map(x => x.instance)).toEqual([3, 4, 5]);
    const f = { file: 'first' }, l = { file: 'late' };
    const b = groupSeries([meta(0, { instance: 1, ...f }), meta(0, { instance: 1, ...l }), meta(0.5, { instance: 2 }), meta(1, { instance: 3 })])[0];
    expect(b.slices[0].file).toBe('first');
  });

  it('does not drop anything when every slice has the same position', () => {
    const s = groupSeries([1, 2, 3].map(i => meta(4, { instance: i })))[0];
    expect(s.slices).toHaveLength(3);
    expect(s.spacingCheck).toMatchObject({ allDuplicates: true, warn: true, duplicatesExcluded: 0 });
    expect(spacingWarningText(s.spacingCheck).ja).toContain('除外できず');
  });

  it('a wrong first gap no longer skews the volume (whole span is used)', () => {
    const s = series([0, 0.1, 0.6, 1.1, 1.6, 2.1]); // first gap 0.1 would have been used before
    expect(s.spacingZ).toBeCloseTo(2.1 / 5, 10); // (last - first) / (N - 1); first-two rule gave 0.1
    expect(volumeMm3(s, 100)).toBeCloseTo(100 * 0.1 * 0.2 * 0.42, 10);
    expect(volumeMm3(s, 100)).not.toBeCloseTo(100 * 0.1 * 0.2 * 0.1, 6);
  });

  it('detects non-uniform spacing above 1% and reports the spread', () => {
    const s = series([0, 0.5, 1.02, 1.5, 2.0]); // gaps .5 .52 .48 .5 -> spread 8%
    const c = s.spacingCheck;
    expect(c.nonUniform).toBe(true);
    expect(c.warn).toBe(true);
    expect(c.spreadPct).toBeCloseTo(8, 5);
    expect(c.medianGap).toBeCloseTo(0.5, 10);
    expect(spacingWarningText(c).ja).toContain('間隔のばらつき 8%');
  });

  it('tolerates float noise below the 1% threshold', () => {
    const c = series([0, 0.5, 1.0004, 1.4998, 2.0001]).spacingCheck;
    expect(c.nonUniform).toBe(false);
    expect(c.warn).toBe(false);
    expect(SPACING_THRESHOLDS.uniformRel).toBe(0.01);
  });

  it('flags SpacingBetweenSlices that disagrees with the measured gaps; thickness is only recorded', () => {
    const a = series([0, 0.5, 1, 1.5], { spacingBetween: 1 }).spacingCheck;
    expect(a).toMatchObject({ spacingBetweenMismatch: true, warn: true, used: 0.5 });
    expect(spacingWarningText(a).ja).toContain('SpacingBetweenSlices');
    const b = series([0, 0.5, 1, 1.5], { thickness: 2 }).spacingCheck; // overlapping/gapped recon is legitimate
    expect(b).toMatchObject({ thicknessDiffers: true, spreadPct: 0, warn: false });
    const c = series([0, 0.5, 1, 1.5], { spacingBetween: 0.5 }).spacingCheck;
    expect(c.warn).toBe(false);
  });

  it('sorts and measures along the normal for an oblique orientation', () => {
    // rows along x, columns tilted 30 deg about x: normal = (0, -sin30, cos30)
    const a = Math.PI / 6, orientation = [1, 0, 0, 0, Math.cos(a), Math.sin(a)];
    const n = sliceNormal(orientation);
    expect(n[0]).toBeCloseTo(0, 10);
    const step = 0.5, mk = k => meta(0, { orientation, pos: [0, k * step * n[1], k * step * n[2]] });
    const slices = [3, 1, 0, 2, 4].map(mk); // shuffled
    const s = groupSeries(slices)[0];
    expect(s.spacingCheck).toMatchObject({ method: 'normal', warn: false });
    expect(s.spacingZ).toBeCloseTo(step, 10); // Z-only would give 0.5*cos30 = 0.433
    const proj = s.slices.map(x => x.pos[1] * n[1] + x.pos[2] * n[2]);
    expect(proj).toEqual([...proj].sort((p, q) => p - q));
    expect(proj[0]).toBeCloseTo(0, 10);
  });

  it('axial orientation tag gives the same result as the Z fallback', () => {
    const o = [1, 0, 0, 0, 1, 0];
    const z = series([0, 0.5, 1, 1.5]), n = series([0, 0.5, 1, 1.5], { orientation: o });
    expect(n.spacingZ).toBe(z.spacingZ);
  });

  it('falls back to the tags when positions are missing or there is one slice', () => {
    const noPos = groupSeries([1, 2, 3].map(i => meta(0, { pos: null, instance: i, spacingBetween: 0.7 })))[0];
    expect(noPos.spacingZ).toBe(0.7);
    expect(noPos.spacingCheck.warn).toBe(false);
    expect(groupSeries([meta(0)])[0].spacingZ).toBe(0.5);
  });

  it('many duplicates do not collapse the reference gap to zero', () => {
    const c = analyzeSliceSpacing([0, 0, 0, 0.5, 0.5, 1].map(z => meta(z)));
    expect(c.duplicates).toBe(3);
    expect(c.medianGap).toBeCloseTo(0.5, 10);
  });

  it('parses ImageOrientationPatient from a synthetic DICOM header', async () => {
    const f = asFile(makeCtSlice({ orientation: [1, 0, 0, 0, 1, 0] }), 'a.dcm');
    const m = parsedSliceMeta(f, await parseDicomHeader(f));
    expect(m.orientation).toEqual([1, 0, 0, 0, 1, 0]);
  });

  it('is stored in the project file as an optional field without a version change', () => {
    const c = spacingCheckForProject(series([0, 0.5, 1, 2]).spacingCheck);
    const bytes = packProject({ dataset: {}, spacingCheck: c });
    const back = unpackProject(bytes).project;
    expect(back.version).toBe(1);
    expect(back.spacingCheck).toMatchObject({ missing: 1, basis: 'fit', used: 0.5 });
    expect(unpackProject(packProject({ dataset: {} })).project.spacingCheck).toBeUndefined();
  });

  it('keeps main\'s order for flipped axial orientations (z ascending)', () => {
    const zs = [3, 1, 0, 2];
    for (const o of [[-1, 0, 0, 0, 1, 0], [1, 0, 0, 0, -1, 0], [1, 0, 0, 0, 1, 0]]) {
      const s = groupSeries(zs.map(z => meta(z, { orientation: o, instance: z + 1 })))[0];
      expect(s.slices.map(x => x.pos[2])).toEqual([0, 1, 2, 3]);
      expect(s.spacingCheck).toMatchObject({ warn: false, used: 1 });
    }
  });

  it('coronal orientation follows InstanceNumber (either sign), not Z', () => {
    for (const o of [[1, 0, 0, 0, 0, -1], [1, 0, 0, 0, 0, 1]]) {
      const n = sliceNormal(o);
      // slices stacked along +/- y; instance numbers ascend with y
      const slices = [2, 0, 3, 1].map(k => meta(0, { orientation: o, pos: [0, k * 0.5, 7], instance: k + 1 }));
      const s = groupSeries(slices)[0];
      expect(s.slices.map(x => x.instance)).toEqual([1, 2, 3, 4]);
      expect(s.spacingCheck).toMatchObject({ method: 'normal', warn: false });
      expect(s.spacingZ).toBeCloseTo(0.5, 10);
      expect(Math.abs(n[1])).toBe(1);
    }
    // instance numbers descending with y -> order follows the instances
    const o = [1, 0, 0, 0, 0, -1];
    const s = groupSeries([0, 1, 2].map(k => meta(0, { orientation: o, pos: [0, k, 7], instance: 3 - k })))[0];
    expect(s.slices.map(x => x.instance)).toEqual([1, 2, 3]);
  });

  it('uniform axial data with orientation tags gives the identical volume as without', () => {
    const zs = [0, 0.35, 0.7, 1.05];
    const a = series(zs), b = series(zs, { orientation: [1, 0, 0, 0, 1, 0] });
    expect(b.spacingZ).toBe(a.spacingZ);
    expect(volumeMm3(b, 777)).toBe(volumeMm3(a, 777));
  });

  it('multi-frame: synthetic positions, tag spacing, no warning, frame order', () => {
    const m = meta(5, { numberOfFrames: 4, ts: '1.2.840.10008.1.2.4.50', spacingBetween: 0.4, instance: 1 });
    const frames = expandParsedFrames(m);
    expect(frames.every(f => f.syntheticPos)).toBe(true);
    const s = groupSeries([...frames].reverse())[0];
    expect(s.slices.map(f => f.frameIndex)).toEqual([0, 1, 2, 3]);
    expect(s.spacingCheck).toMatchObject({ method: 'frames', basis: 'frames', warn: false, info: false, used: 0.4 });
    expect(s.spacingZ).toBe(0.4);
    expect(spacingWarningText(s.spacingCheck)).toBeNull();
  });

  it('does not flag non-uniform for 0.0187 mm slices with positions rounded to 3 decimals', () => {
    const zs = Array.from({ length: 200 }, (_, k) => Math.round(k * 0.0187 * 1000) / 1000);
    const c = series(zs).spacingCheck;
    expect(c).toMatchObject({ nonUniform: false, duplicates: 0, missing: 0, warn: false });
  });

  it('still flags large spread on thin slices (above the absolute floor)', () => {
    const c = series([0, 0.05, 0.1, 0.16, 0.21]).spacingCheck; // gaps differ by 0.01 mm = 20%
    expect(c.nonUniform).toBe(true);
  });

  it('case-specific warning text', () => {
    const m = spacingWarningText(series([0, 0.5, 1, 2, 2.5]).spacingCheck);
    expect(m.level).toBe('warn');
    expect(m.ja).toContain('抜けた部分は体積に含まれません（過小評価）');
    expect(m.ja).toContain('約 0.5 mm ずれます');
    expect(m.en).toContain('underestimate');
    const d = spacingWarningText(series([0, 0.5, 0.5, 1]).spacingCheck);
    expect(d.ja).toContain('重複スライスはボリュームから除外しました');
    const n = spacingWarningText(series([0, 0.5, 1.02, 1.5, 2.0]).spacingCheck);
    expect(n.jaDetail).toBe('間隔が不均一なため、全体の平均 0.5 mm による近似。局所的な構造では近似です');
    expect(n.jaSummary).not.toContain('近似');
    expect(n.jaDetail).toContain('局所的な構造では近似です');
    expect(n.enDetail).toContain('only approximate for local structures');
  });

  it('no positions: method none, tag value used with an info-level note', () => {
    const s = groupSeries([1, 2, 3].map(i => meta(0, { pos: null, instance: i, spacingBetween: 0.7 })))[0];
    expect(s.spacingCheck).toMatchObject({ method: 'none', info: true, warn: false, used: 0.7 });
    const w = spacingWarningText(s.spacingCheck);
    expect(w.level).toBe('info');
    expect(w.ja).toBe('位置情報なしのためタグ値 0.7 mm を使用（未検証）');
    expect(w.en).toContain('unverified');
  });

  it('partial positions: previous behaviour (first two gap), info note', () => {
    const s = groupSeries([meta(0, { instance: 1 }), meta(0.5, { instance: 2 }), meta(0, { pos: null, instance: 3 })])[0];
    expect(s.spacingCheck).toMatchObject({ method: 'partial', info: true, warn: false, positionsIncomplete: true });
    expect(s.spacingZ).toBe(0.5);
    expect(spacingWarningText(s.spacingCheck).ja).toContain('位置情報が不完全');
  });

  it('warns on mixed orientation tags within a series', () => {
    const s = groupSeries([
      meta(0, { orientation: [1, 0, 0, 0, 1, 0] }), meta(0.5, { orientation: [1, 0, 0, 0, 1, 0] }), meta(1, { orientation: [1, 0, 0, 0, 0, -1] }),
    ])[0];
    expect(s.spacingCheck.orientationMixed).toBe(true);
    expect(s.spacingCheck.warn).toBe(true);
    expect(spacingWarningText(s.spacingCheck).ja).toContain('向き');
  });

  it('rounded micro-CT spacing (0.0187 mm, positions to 3 decimals): error < 0.1%', () => {
    const zs = Array.from({ length: 200 }, (_, k) => Math.round(k * 0.0187 * 1000) / 1000);
    const s = series(zs);
    expect(Math.abs(s.spacingZ - 0.0187) / 0.0187).toBeLessThan(0.001);
    expect(s.spacingCheck.basis).toBe('span');
    // the old first-two rule was off by several percent on the same data
    expect(Math.abs(s.spacingCheck.legacyZ - 0.0187) / 0.0187).toBeGreaterThan(0.001);
  });

  it('missing slices: the fit estimates the spacing (rounded positions, < 0.1%)', () => {
    const keep = Array.from({ length: 200 }, (_, k) => k).filter(k => ![20, 21, 90, 150].includes(k));
    const s = series(keep.map(k => Math.round(k * 0.0187 * 1000) / 1000));
    expect(s.spacingCheck).toMatchObject({ missing: 4, basis: 'fit', warn: true });
    expect(Math.abs(s.spacingZ - 0.0187) / 0.0187).toBeLessThan(0.001);
    // the naive whole-span formula would be wrong here
    const naive = (keep.at(-1) * 0.0187) / (keep.length - 1);
    expect(Math.abs(naive - 0.0187) / 0.0187).toBeGreaterThan(0.01);
  });
});

describe('old projects (spacing rule changed in build 469)', () => {
  // old data: first two slices 0.1 apart by mistake, the rest 0.5 -> old Z = 0.1, new Z = 0.42
  const zs = [0, 0.1, 0.6, 1.1, 1.6, 2.1];
  const cur = () => datasetFingerprint(series(zs));
  const saved = () => ({ ...cur(), spacing: [cur().spacing[0], cur().spacing[1], 0.1], legacySpacingZ: undefined });

  it('records the legacy value and the fingerprint carries it', () => {
    expect(cur().legacySpacingZ).toBe(0.1);
    expect(cur().spacing[2]).toBeCloseTo(0.42, 6);
  });

  it('only z differs and saved z = old first-two difference: asks, accept opens with the new spacing', () => {
    expect(compareFingerprints(saved(), cur()).ok).toBe(false);
    expect(legacySpacingUpgrade(saved(), cur())).toEqual({ savedZ: 0.1, newZ: cur().spacing[2] });
    let asked = null;
    const r = resolveProjectMatch(saved(), cur(), t => { asked = t; return true; }, 'ja');
    expect(r.action).toBe('apply');
    expect(asked).toContain('build 469 からスライス間隔の決め方が変わりました');
    expect(asked).toContain('保存時 0.1 mm → 新しい間隔 0.42 mm（+320%）');
    expect(asked).toContain('新しい間隔で開きますか？');
    expect(asked).toContain('体積が 320% 変わります。以前の結果は再計算が必要です');
    expect(asked).not.toContain('わずかに');
  });

  it('prompt: small changes (<= 1%) stay mild, in both languages', () => {
    const small = legacySpacingPrompt({ savedZ: 0.5, newZ: 0.5025 });
    expect(small.ja).toContain('（+0.5%）');
    expect(small.ja).toContain('体積がわずかに変わります');
    expect(small.en).toContain('Volumes change slightly');
    const big = legacySpacingPrompt({ savedZ: 0.5, newZ: 0.45 });
    expect(big.ja).toContain('体積が 10% 変わります。以前の結果は再計算が必要です');
    expect(big.en).toContain('Volumes change by 10%. Earlier results need to be recalculated');
  });

  it('acceptance applies only to the accepted series (id + legacy check), not to another series', () => {
    const a = { ...cur(), seriesId: 'A' };
    const other = datasetFingerprint(series([0, 1, 2, 3, 4, 5]));
    const pending = { legacyAccepted: 'A' };
    // the gate used by applyPendingProject
    const gate = (activeId, fp) => pending.legacyAccepted != null && pending.legacyAccepted === activeId && !!legacySpacingUpgrade(saved(), fp);
    expect(gate('A', a)).toBe(true);
    expect(gate('B', other)).toBe(false); // another series: normal matching, which rejects it
    expect(gate('A', other)).toBe(false); // same id but not a legacy match
    expect(resolveProjectMatch(saved(), other, () => { throw new Error('must not ask'); }).action).toBe('reject');
  });

  it('cancel keeps the project unapplied', () => {
    expect(resolveProjectMatch(saved(), cur(), () => false, 'ja').action).toBe('cancel');
  });

  it('comments saved with the legacy spacing still match the series (index mapping unchanged)', () => {
    expect(compareFingerprints(saved(), cur(), { legacyZ: true }).ok).toBe(true);
  });

  it('rejects when something else differs, or the saved z is neither old nor new', () => {
    const other = { ...saved(), slices: 7 };
    expect(resolveProjectMatch(other, cur(), () => true).action).toBe('reject');
    const odd = { ...saved(), spacing: [cur().spacing[0], cur().spacing[1], 0.3] };
    const r = resolveProjectMatch(odd, cur(), () => { throw new Error('must not ask'); });
    expect(r.action).toBe('reject');
    expect(compareFingerprints(odd, cur(), { legacyZ: true }).ok).toBe(false);
    const xy = { ...saved(), spacing: [9, cur().spacing[1], 0.1] };
    expect(legacySpacingUpgrade(xy, cur())).toBeNull();
  });

  it('a project of a series whose duplicates are now excluded is rejected with a clear reason', () => {
    const dupCur = datasetFingerprint(series([0, 0.5, 0.5, 1, 1.5]));
    const old = { ...dupCur, slices: 5, duplicatesExcluded: 0 };
    const r = resolveProjectMatch(old, dupCur, () => true);
    expect(r.action).toBe('reject');
    expect(r.reason.ja).toBe('このデータは重複スライスを除外するようになったため、以前のプロジェクトとスライス数が合いません');
  });

  it('a project saved with the new rule matches as before', () => {
    expect(resolveProjectMatch(cur(), cur(), () => { throw new Error('no ask'); }).action).toBe('apply');
  });
});
