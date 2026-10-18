import { describe, it, expect, beforeAll } from 'vitest';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// build 531: the fifth preset (contrast) in the .vrlab project: new projects carry it, old projects (four presets) open unchanged
installDomStub();
let D, S, ST;
beforeAll(async () => { S = await importApp('segments'); ST = await importApp('state'); D = await importApp('data-load'); });

const reset = () => {
  for (const k of S.SEGMENT_PRESET_ORDER) { Object.assign(S.segmentState[k], { active: false, enabled: false }); const e = S.segmentEditState[k]; e.keepRuns = e.excludeRuns = null; }
};

describe('save', () => {
  it('writes a contrast entry (all fields, like the other segments) and the order with contrast', () => {
    reset(); ST.setActiveSeries({ id: 's1', slices: [{}, {}], rows: 4, columns: 4 });
    Object.assign(S.segmentState.contrast, { active: true, enabled: true, userMin: 310, userMax: 2500, min: 310, max: 2500, color: '#c026d3', minComponent: 150 });
    S.segmentExclusive.mode = 'priority'; S.segmentExclusive.order = ['contrast', 'bone', 'fat', 'soft', 'lung'];
    const { project } = D.gatherProject();
    expect(Object.keys(project.segments)).toEqual(['bone', 'soft', 'fat', 'lung', 'contrast']);
    expect(project.segments.contrast).toMatchObject({ active: true, enabled: true, color: '#c026d3', min: 310, max: 2500, minComponent: 150 });
    expect(project.segmentOptions).toEqual({ exclusive: 'priority', order: ['contrast', 'bone', 'fat', 'soft', 'lung'] });
    expect(project.segments.bone.active).toBe(false);
    const json = JSON.parse(JSON.stringify(project)); // what a .vrlab holds
    expect(json.segments.contrast.max).toBe(2500);
  });
  it('a manual edit of contrast is saved as its own file (edits/contrast-keep.bin)', () => {
    reset(); ST.setActiveSeries({ id: 's1', slices: [{}, {}], rows: 4, columns: 4 });
    S.segmentEditState.contrast.keepRuns = [[1, 0, 2], []];
    const { project, binaries } = D.gatherProject();
    expect(project.edits.contrast.keep).toBe('edits/contrast-keep.bin');
    expect(binaries['edits/contrast-keep.bin']).toBeTruthy();
  });
});

describe('load', () => {
  const dims = { id: 's1', slices: [{}, {}], rows: 4, columns: 4 };
  it('an old project (four presets, no segmentOptions order with contrast) keeps its overlap rule and gets contrast appended at the end', async () => {
    reset(); ST.setActiveSeries(dims); S.segmentExclusive.order = ['contrast', 'bone', 'fat', 'soft', 'lung'];
    const old = { app: { build: '500' }, segments: { bone: { active: false }, soft: { active: false }, fat: { active: false }, lung: { active: false } }, segmentOptions: { exclusive: 'off', order: ['soft', 'bone', 'fat', 'lung'] } };
    await D.applyProject({ project: old, files: {} });
    expect(S.segmentExclusive.mode).toBe('off');
    expect(S.segmentExclusive.order).toEqual(['soft', 'bone', 'fat', 'lung', 'contrast']);
    expect(S.segmentState.contrast.active).toBe(false); expect(S.segmentState.contrast.enabled).toBe(false);
  });
  it('a project from before build 438 (no segmentOptions at all) loads as exclusive off', async () => {
    reset(); ST.setActiveSeries(dims);
    await D.applyProject({ project: { app: { build: '400' }, segments: {} }, files: {} });
    expect(S.segmentExclusive.mode).toBe('off');
    expect(S.segmentState.contrast.active).toBe(false);
  });
  it('a new project keeps the saved order (contrast first)', async () => {
    reset(); ST.setActiveSeries(dims);
    const proj = { app: { build: '531' }, segments: {}, segmentOptions: { exclusive: 'priority', order: ['contrast', 'bone', 'fat', 'soft', 'lung'] } };
    await D.applyProject({ project: proj, files: {} });
    expect(S.segmentExclusive.mode).toBe('priority');
    expect(S.segmentExclusive.order).toEqual(['contrast', 'bone', 'fat', 'soft', 'lung']);
  });
  it('an unknown segment key in a project (from a later app) is ignored, not an error', async () => {
    reset(); ST.setActiveSeries(dims);
    const proj = { app: { build: '999' }, segments: { vessel: { active: true, enabled: true } }, segmentOptions: { exclusive: 'priority', order: ['vessel', 'bone', 'fat', 'soft', 'lung', 'contrast'] }, edits: { vessel: { keep: 'edits/vessel-keep.bin' } } };
    await D.applyProject({ project: proj, files: {} });
    expect(S.segmentExclusive.order).toEqual(['bone', 'fat', 'soft', 'lung', 'contrast']);
  });
});
