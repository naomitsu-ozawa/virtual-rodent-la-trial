import { describe, it, expect } from 'vitest';
import { packProject, unpackProject, encodeRuns } from '../../docs/project-file.js';
import { readFileSync } from 'node:fs';
import { SEGMENT_PRESET_ORDER, partnerInputs, segmentStateOf, exclusiveRuleOf, regionsOf, partnerLabelOf, unsupportedOf, unitsPerMmOfSeries, resultRepresentativeVoxel } from '../../docs/vr-pair-data.js';
import { volumeMeta, shownMask, editDescsOf, regionItemsOf, childItemsOf, classifyStateOf, shownRegions } from '../../docs/vr-prep-inputs.js';
import { effectiveRanges, nextDown } from '../../docs/segment-exclusive.js';
import { prepRun } from '../../docs/vr-volume-prep.js';

// The partner of a sample pair (docs/vr-pair-data.js): its VR preparation input is made from its own unpacked .vrlab and its series. The fixture is made with packProject / encodeRuns here
// (a made-up project: the bundled sample data is never read by a test).

const COLS = 24, ROWS = 20, SL = 16;
const series = { id: 'PARTNER', columns: COLS, rows: ROWS, slices: Array.from({ length: SL }, () => ({ signed: true, slope: 2, intercept: 5 })), spacingX: 0.04, spacingY: 0.04, spacingZ: 0.02 };
const box = (z0, z1, y0, y1, x0, x1) => Array.from({ length: SL }, (_, z) => (z >= z0 && z <= z1 ? Uint32Array.from(Array.from({ length: y1 - y0 + 1 }, (_, i) => [y0 + i, x0, x1]).flat()) : null));
const seg = (over = {}) => ({ active: false, enabled: false, color: '#aabbcc', opacity: 1, min: -2000, max: 7000, opening: 0, closing: 0, minComponent: 0, holeFill: false, surfaceMm: 0, thicknessMm: 0, material: 'standard', ...over });
const projectOf = (over = {}) => ({
  dataset: { seriesUid: 'U', columns: COLS, rows: ROWS, slices: SL },
  filters: { order: [] }, segmentOptions: { exclusive: 'priority', order: ['contrast', 'bone', 'fat', 'soft', 'lung'] },
  segments: { bone: seg({ active: true, enabled: true, color: '#f3f0e8', min: 1200, max: 7000 }), soft: seg({ active: true, enabled: true, color: '#f7a99c', min: 300, max: 7000 }), fat: seg(), lung: seg(), contrast: seg() },
  edits: {},
  analysis: { regions: [
    { key: 'region-1', segmentKeys: ['bone'], color: 55551, runs: 'analysis/region-1.bin' },
    { key: 'region-2', segmentKeys: ['soft', 'bone'], color: 255, runs: 'analysis/region-2.bin' },
    { key: 'region-3', segmentKeys: ['bone'], color: 7, runs: 'analysis/region-3.bin' }, // no voxels: no id
    { key: 'region-4', segmentKeys: ['nonsense'], color: 9, runs: 'analysis/region-4.bin' }, // not a preset: left out
  ] },
  ...over,
});
const binaries = () => ({ 'analysis/region-1.bin': encodeRuns(box(2, 5, 3, 8, 4, 9), SL), 'analysis/region-2.bin': encodeRuns(box(6, 9, 1, 4, 2, 5), SL), 'analysis/region-3.bin': encodeRuns(box(0, -1, 0, 0, 0, 0), SL), 'analysis/region-4.bin': encodeRuns(box(1, 1, 1, 1, 1, 1), SL) });
const unpacked = (over) => unpackProject(packProject(projectOf(over), binaries()));

describe('the preset keys', () => {
  it('agree with segments.js SEGMENT_PRESET_ORDER (this module is pure and keeps a copy)', () => {
    const src = readFileSync(new URL('../../docs/segments.js', import.meta.url), 'utf8'), m = /export const SEGMENT_PRESET_ORDER=\[([^\]]*)\]/.exec(src);
    expect(m).not.toBe(null); expect(m[1].split(',').map(x => x.trim().replace(/'/g, ''))).toEqual(SEGMENT_PRESET_ORDER);
  });
});

describe('segmentStateOf / exclusiveRuleOf', () => {
  it('the range in use is the user range minus the segments above it (the page\'s effectiveRanges), colour and flags as saved', () => {
    const st = segmentStateOf(projectOf());
    // order contrast > bone > fat > soft > lung: soft (300..7000) loses what bone (1200..7000) holds -> 300 .. just below 1200
    expect(st.bone).toMatchObject({ active: true, enabled: true, min: 1200, max: 7000, color: '#f3f0e8' });
    expect(st.soft.min).toBe(300); expect(st.soft.max).toBe(nextDown(1200)); expect(st.soft.active).toBe(true);
    expect(st.fat).toMatchObject({ active: false, enabled: false });
    const e = effectiveRanges({ bone: { userMin: 1200, userMax: 7000, active: true }, soft: { userMin: 300, userMax: 7000, active: true } }, ['contrast', 'bone', 'fat', 'soft', 'lung'], 'priority');
    expect(st.soft.max).toBe(e.soft.max);
  });
  it('a project without the overlap rule keeps overlaps (mode off), as applyProject reads it; the order is filled up like the page', () => {
    const p = projectOf({ segmentOptions: undefined });
    expect(exclusiveRuleOf(p)).toEqual({ mode: 'off', order: ['contrast', 'bone', 'fat', 'soft', 'lung'] });
    expect(segmentStateOf(p).soft).toMatchObject({ min: 300, max: 7000 });
    expect(exclusiveRuleOf({ segmentOptions: { exclusive: 'priority', order: ['soft', 'x', 'bone'] } })).toEqual({ mode: 'priority', order: ['soft', 'bone', 'fat', 'lung', 'contrast'] });
    expect(exclusiveRuleOf({ segmentOptions: { exclusive: 'bogus' } }).mode).toBe('off');
  });
  it('a segment the project does not list is inactive with an empty range', () => {
    const st = segmentStateOf(projectOf({ segments: { bone: seg({ active: true, enabled: true, min: 1, max: 2 }) } }));
    expect(st.lung).toMatchObject({ active: false, enabled: false, min: 0, max: 0 });
  });
});

describe('regionsOf', () => {
  it('decodes the runs, counts voxels / mm3, numbers the results 1.. and leaves out one without voxels or without a preset segment', () => {
    const { project, files } = unpacked(), dims = { slices: SL, columns: COLS, rows: ROWS }, vox = 0.04 * 0.04 * 0.02;
    const r = regionsOf(project, files, dims, vox);
    expect(r.map(x => x.id)).toEqual([1, 2]);
    expect(r[0]).toMatchObject({ color: 55551, segmentKeys: ['bone'], voxels: 4 * 6 * 6 });
    expect(r[0].mm3).toBe(r[0].voxels * vox);
    expect(r[0].atlasId).toBeUndefined();
    const withAtlas = regionsOf({ ...project, analysis: { regions: project.analysis.regions.map((e, i) => ({ ...e, atlasId: 30 + i })) } }, files, dims, vox);
    expect(withAtlas.map(x => x.atlasId)).toEqual([30, 31]);
    expect(r[1].segmentKeys).toEqual(['soft', 'bone']);
    expect(r[0].runsBySlice[2]).toEqual(Uint32Array.from([3, 4, 9, 4, 4, 9, 5, 4, 9, 6, 4, 9, 7, 4, 9, 8, 4, 9]));
    expect(r[0].runsBySlice[0]).toBe(null);
  });
  it('carries the name and the name label (anchor, offset) of a result when the project has them (the partner\'s cards, stage 3); bad numbers are dropped', () => {
    const { project, files } = unpacked(), dims = { slices: SL, columns: COLS, rows: ROWS };
    const regs = project.analysis.regions.map((e, i) => i === 0 ? { ...e, name: ' 爪 ', label: { anchor: { i: 4, j: 5, k: 6 }, offset: { i: -1.5, j: 2, k: 0 } } } : { ...e, name: '', label: { anchor: { i: 'x', j: 1, k: 1 } } });
    const r = regionsOf({ ...project, analysis: { regions: regs } }, files, dims, 1);
    expect(r[0].name).toBe('爪'); expect(r[0].label).toEqual({ anchor: { i: 4, j: 5, k: 6 }, offset: { i: -1.5, j: 2, k: 0 } });
    expect(r[1].name).toBeUndefined(); expect(r[1].label).toBeUndefined();
    expect(partnerLabelOf({ anchor: { i: 1, j: 2, k: 3 } })).toEqual({ anchor: { i: 1, j: 2, k: 3 } }); expect(partnerLabelOf(null)).toBe(null); expect(partnerLabelOf({ anchor: { i: 1, j: 2, k: 3 }, offset: { i: 1 } })).toEqual({ anchor: { i: 1, j: 2, k: 3 } });
  });
  it('a missing runs file is an error (never a silently empty result)', () => {
    const { project, files } = unpacked(); delete files['analysis/region-1.bin'];
    expect(() => regionsOf(project, files, { slices: SL, columns: COLS, rows: ROWS }, 1)).toThrow('missing analysis/region-1.bin');
  });
  it('runs that do not fit the series are an error', () => {
    const { project, files } = unpacked();
    expect(() => regionsOf(project, files, { slices: SL + 1, columns: COLS, rows: ROWS }, 1)).toThrow();
  });
});

describe('unsupportedOf', () => {
  it('says what the raw partner data cannot show (edits, child segments, filters, post-processing); a plain project: nothing', () => {
    expect(unsupportedOf(projectOf())).toEqual([]);
    expect(unsupportedOf(projectOf({ edits: { bone: { keep: 'edits/bone-keep.bin' } } }))).toEqual(['edits']);
    expect(unsupportedOf(projectOf({ treeSegments: [{ key: 'c' }] }))).toEqual(['childSegments']);
    expect(unsupportedOf(projectOf({ filters: { order: [{ key: 'median' }] } }))).toEqual(['filters']);
    expect(unsupportedOf(projectOf({ segments: { bone: seg({ active: true, enabled: true, opening: 1 }) } }))).toEqual(['postProcessing']);
    expect(unsupportedOf(projectOf({ segments: { bone: seg({ active: false, opening: 1 }) } }))).toEqual([]); // inactive: not drawn
  });
});

describe('partnerInputs', () => {
  const { project, files } = unpacked();
  it('is the input of docs/vr-prep-inputs.js: the slots, the shown mask, the classification state, the results, no edits / children', () => {
    const inp = partnerInputs({ project, files, series });
    expect(inp.order).toEqual(['bone', 'soft', 'fat', 'lung']);
    expect(shownMask(inp)).toBe(0b0011); // bone + soft are shown (fat / lung inactive)
    expect(classifyStateOf(inp)).toEqual({ bone: { active: true, enabled: true, min: 1200, max: 7000 }, soft: { active: true, enabled: true, min: 300, max: nextDown(1200) }, fat: { active: false, enabled: false, min: -2000, max: 7000 }, lung: { active: false, enabled: false, min: -2000, max: 7000 } });
    expect(editDescsOf(inp)).toEqual({ descs: [], sourceDims: [COLS, ROWS, SL] });
    expect(childItemsOf(inp)).toEqual([]);
    const items = regionItemsOf(inp);
    expect(items.map(i => [i.color, i.segMask, i.rid, i.segmentKeys])).toEqual([[55551, 1, 1, ['bone']], [255, 3, 2, ['soft', 'bone']]]);
    expect(shownRegions(inp)).toHaveLength(2);
    expect(inp.unsupported).toEqual([]); expect(inp.segmentColors.bone).toBe('#f3f0e8');
    expect('unitsPerMm' in inp).toBe(false);
  });
  it('event mode: an active segment with its checkbox off is prepared and shown as the page does (vrSegments enabled = active); segMode 2 hides it', () => {
    const p = projectOf({ segments: { bone: seg({ active: true, enabled: true, min: 1200, max: 7000 }), soft: seg({ active: true, enabled: false, min: 300, max: 1000 }), fat: seg(), lung: seg(), contrast: seg() } });
    const u = unpackProject(packProject(p, binaries()));
    const off = partnerInputs({ project: u.project, files: u.files, series });
    expect(shownMask(off)).toBe(0b0001);
    const ev = partnerInputs({ project: u.project, files: u.files, series, eventMode: true });
    expect(shownMask(ev)).toBe(0b0011); expect(ev.vrSegments.soft.enabled).toBe(true); expect(off.vrSegments.soft.enabled).toBe(false);
    expect(shownMask(partnerInputs({ project: u.project, files: u.files, series, eventMode: true, segMode: { soft: 2 } }))).toBe(0b0001);
  });
  it('the primary\'s scale makes the partner the same size per mm (volumeMeta of both)', () => {
    const primary = { ...series, id: 'PRIMARY', columns: 48, rows: 30, spacingX: 0.04, spacingY: 0.04, spacingZ: 0.04 };
    const upm = unitsPerMmOfSeries(primary);
    const mp = volumeMeta({ volume: { sourceBacked: true, series: primary, columns: 48, rows: 30, slices: SL } }, 256);
    const own = volumeMeta(partnerInputs({ project, files, series }), 256), shared = volumeMeta(partnerInputs({ project, files, series, unitsPerMm: upm }), 256);
    expect(own.halfExt[0] * 2).toBeCloseTo(0.96 * 3.3, 12); // alone: its own scale (3.3 per mm: the longest side is under 1 mm, which the scale's floor of 1 mm keeps as before)
    expect(shared.halfExt[0] / mp.halfExt[0]).toBeCloseTo((COLS * 0.04) / (48 * 0.04), 12); // together: the real ratio (24 : 48 columns of the same pitch)
    expect(shared.calibration).toEqual([2, 5, 32768]); // the partner's own calibration, signed
  });
  it('the worker classification job runs on it with no warning and finds the results (prepRun cls)', () => {
    const inp = partnerInputs({ project, files, series }), dims = [12, 10, 8], bytes = new Uint8Array(12 * 10 * 8 * 2).map((_, i) => (i * 31) & 255);
    const ed = editDescsOf(inp); let out = null;
    prepRun({ t: 'cls', id: 1, src: bytes.buffer, dims, calib: [1, 0, 0], editDescs: ed.descs, editSourceDims: ed.sourceDims, regionItems: regionItemsOf(inp), order: inp.order, state: classifyStateOf(inp), childItems: childItemsOf(inp), brickDimsFull: [4, 3, 2], brickDimsHalf: null, mask: shownMask(inp) }, m => { if (m.t !== 'progress') out = m; });
    expect(out.warnings).toEqual([]); expect(out.region.list).toHaveLength(2); expect(out.edit.active).toBe(0);
  });
  it('needs a project and a series', () => {
    expect(() => partnerInputs({ project, files, series: null })).toThrow();
    expect(() => partnerInputs({ project: null, files, series })).toThrow();
  });
});

describe('the representative voxel of a result (the target of the name card surface search)', () => {
  it('is a voxel INSIDE the result: the middle run of the middle non-empty slice (the same choice as the page\'s analysisRegionRepresentativeVoxel)', async () => {
    const runsBySlice = box(4, 8, 5, 9, 3, 12); // z 4..8 (5 slices, the middle one z = 6), rows y 5..9 (the middle record: y = 7), x 3..12 (the middle of the run: 7)
    expect(resultRepresentativeVoxel({ runsBySlice })).toEqual({ i: 7, j: 7, k: 6 });
    // equal to the page's rule (analysis-results.js reads the DOM: its function is compared by source text instead of being imported)
    const page = readFileSync(new URL('../../docs/analysis-results.js', import.meta.url), 'utf8'), f = page.slice(page.indexOf('export function analysisRegionRepresentativeVoxel'), page.indexOf('// move=false keeps the slice positions'));
    expect(f).toContain('nonEmpty[Math.floor(nonEmpty.length/2)]'); expect(f).toContain('Math.floor((rec.length/3)/2)*3'); expect(f).toContain('Math.floor((rec[i+1]+rec[i+2])/2),y:rec[i],z');
  });
  it('is null without voxels', () => {
    expect(resultRepresentativeVoxel(null)).toBe(null); expect(resultRepresentativeVoxel({})).toBe(null);
    expect(resultRepresentativeVoxel({ runsBySlice: [null, new Uint32Array(0), null] })).toBe(null);
  });
});
