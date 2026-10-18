import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { gpuSlotOrder, canEnableSegment, enabledSegmentCount, slotSignature, GPU_SEGMENT_SLOTS } from '../../docs/segment-slots.js';

// build 531: five presets (bone, soft, fat, lung, contrast), at most four enabled at once; the GPU views have four slots
const ORDER = ['bone', 'soft', 'fat', 'lung', 'contrast'];
const st = (...on) => Object.fromEntries(ORDER.map(k => [k, { active: on.includes(k) || on.includes('~' + k), enabled: on.includes(k) }]));

describe('gpuSlotOrder (pure)', () => {
  it('has four slots', () => { expect(GPU_SEGMENT_SLOTS).toBe(4); });
  it('keeps slot i = order[i] when contrast is not enabled, whatever else is on (identical to before build 531)', () => {
    expect(gpuSlotOrder(ORDER, st())).toEqual(['bone', 'soft', 'fat', 'lung']);
    expect(gpuSlotOrder(ORDER, st('bone', 'fat'))).toEqual(['bone', 'soft', 'fat', 'lung']);
    expect(gpuSlotOrder(ORDER, st('bone', 'soft', 'fat', 'lung'))).toEqual(['bone', 'soft', 'fat', 'lung']);
  });
  it('an enabled contrast takes the first slot whose preset is not enabled', () => {
    expect(gpuSlotOrder(ORDER, st('contrast'))).toEqual(['contrast', 'soft', 'fat', 'lung']);
    expect(gpuSlotOrder(ORDER, st('bone', 'contrast'))).toEqual(['bone', 'contrast', 'fat', 'lung']);
    expect(gpuSlotOrder(ORDER, st('bone', 'soft', 'contrast'))).toEqual(['bone', 'soft', 'contrast', 'lung']);
    expect(gpuSlotOrder(ORDER, st('bone', 'soft', 'fat', 'contrast'))).toEqual(['bone', 'soft', 'fat', 'contrast']);
  });
  it('a preset that is active but switched off does not count as enabled', () => {
    const s = st('bone', 'contrast'); s.soft.active = true; // card shown, checkbox off
    expect(gpuSlotOrder(ORDER, s)).toEqual(['bone', 'contrast', 'fat', 'lung']);
  });
  it('always returns exactly the slot count, and never changes a state or the order passed in', () => {
    const s = st('contrast', 'bone'), o = [...ORDER];
    const r = gpuSlotOrder(ORDER, s);
    expect(r).toHaveLength(4); expect(ORDER).toEqual(o); expect(s.bone.enabled).toBe(true);
  });
  it('with no free slot (five enabled, which canEnableSegment prevents) the extra stays out', () => {
    expect(gpuSlotOrder(ORDER, st(...ORDER))).toEqual(['bone', 'soft', 'fat', 'lung']);
  });
  it('is general: more slots / more presets (N <= 8)', () => {
    const o = ['a', 'b', 'c', 'd', 'e', 'f'], s = { a: { active: 1, enabled: 1 }, e: { active: 1, enabled: 1 }, f: { active: 1, enabled: 1 } };
    expect(gpuSlotOrder(o, s, 4)).toEqual(['a', 'e', 'f', 'd']);
    expect(gpuSlotOrder(o, s, 5)).toEqual(['a', 'f', 'c', 'd', 'e']);
    expect(gpuSlotOrder(o, s, 6)).toEqual(o);
  });
  it('slotSignature tells two slot assignments apart', () => {
    expect(slotSignature(ORDER, st('bone'))).not.toBe(slotSignature(ORDER, st('bone', 'contrast')));
    expect(slotSignature(ORDER, st('bone', 'contrast'))).not.toBe(slotSignature(ORDER, st('soft', 'contrast')));
    expect(slotSignature(ORDER, st('bone'))).toBe(slotSignature(ORDER, st('bone', 'fat')));
  });
});

describe('the enable limit (at most four enabled)', () => {
  it('counts only active and enabled presets', () => {
    const s = st('bone', 'soft'); s.fat.active = true;
    expect(enabledSegmentCount(ORDER, s)).toBe(2);
  });
  it('allows enabling while a slot is free, refuses the fifth, and always allows what is already enabled', () => {
    expect(canEnableSegment(ORDER, st('bone', 'soft', 'fat'), 'contrast')).toBe(true);
    expect(canEnableSegment(ORDER, st('bone', 'soft', 'fat', 'lung'), 'contrast')).toBe(false);
    expect(canEnableSegment(ORDER, st('bone', 'soft', 'fat', 'lung'), 'bone')).toBe(true);
    expect(canEnableSegment(ORDER, st('bone', 'soft', 'fat', 'contrast'), 'lung')).toBe(false);
  });
});

describe('app state with the fifth preset', () => {
  let S, UI, I18N;
  installDomStub();
  beforeAll(async () => { S = await importApp('segments'); UI = await importApp('segment-ui'); I18N = (await importApp('i18n')).I18N; });
  beforeEach(() => { for (const k of S.SEGMENT_PRESET_ORDER) { S.segmentState[k].active = false; S.segmentState[k].enabled = false; } });

  it('the preset list ends with contrast, and the slots of the four older presets are unchanged', () => {
    expect(S.SEGMENT_PRESET_ORDER).toEqual(['bone', 'soft', 'fat', 'lung', 'contrast']);
    for (const k of ['bone', 'soft', 'fat', 'lung']) { S.segmentState[k].active = S.segmentState[k].enabled = true; }
    expect(S.gpuSegmentOrder()).toEqual(['bone', 'soft', 'fat', 'lung']);
  });
  it('gpuSegmentOrder follows the state', () => {
    S.segmentState.bone.active = S.segmentState.bone.enabled = true;
    S.segmentState.contrast.active = S.segmentState.contrast.enabled = true;
    expect(S.gpuSegmentOrder()).toEqual(['bone', 'contrast', 'fat', 'lung']);
    expect(S.gpuSegmentSignature()).toBe('bone,contrast,fat,lung');
  });
  it('contrast starts off, is a normal segment (edit state, generation counter), colour distinct from the other four', () => {
    expect(S.segmentState.contrast.active).toBe(false);
    expect(S.segmentEditState.contrast).toBeTruthy(); expect(S.segmentEditGen.contrast).toBeTypeOf('number');
    const cols = ['bone', 'soft', 'fat', 'lung', 'contrast'].map(k => S.segmentState[k].color);
    expect(new Set(cols).size).toBe(5);
  });
  it('new data: contrast is the top priority; contrast active takes its range from bone (exclusive priority)', () => {
    expect(S.segmentExclusive.order[0]).toBe('contrast');
    for (const [k, lo, hi] of [['contrast', 300, 3000], ['bone', 350, 3000]]) Object.assign(S.segmentState[k], { active: true, enabled: true, userMin: lo, userMax: hi, min: lo, max: hi });
    S.segmentExclusive.mode = 'priority'; S.segmentExclusive.order = ['contrast', 'bone', 'fat', 'soft', 'lung'];
    S.applyExclusiveRanges();
    expect(S.segmentState.contrast.min).toBe(300);
    expect(S.segmentState.bone.exclusive.empty).toBe(true); // wholly inside contrast: bone has nothing left by range alone
  });
  it('refuseSegmentEnable: the fifth enable is refused with a message, nothing changes', () => {
    for (const k of ['bone', 'soft', 'fat', 'lung']) S.segmentState[k].active = S.segmentState[k].enabled = true;
    S.segmentState.contrast.active = true;
    expect(UI.refuseSegmentEnable('contrast')).toBe(true);
    expect(S.segmentState.contrast.enabled).toBe(false);
    expect(Object.values(S.segmentState).filter(g => g.active && g.enabled)).toHaveLength(4);
    S.segmentState.lung.enabled = false; // the user turns one off first
    expect(UI.refuseSegmentEnable('contrast')).toBe(false);
    UI.setSegmentEnabled('contrast', true);
    expect(S.gpuSegmentOrder()).toEqual(['bone', 'soft', 'fat', 'contrast']);
  });
  it('the refusal message exists in Japanese and English', () => {
    expect(I18N.ja.segmentLimit).toMatch(/4/); expect(I18N.en.segmentLimit).toMatch(/4/);
    expect(I18N.ja.contrast).toBe('造影領域'); expect(I18N.en.contrast).toBe('Contrast');
  });
});
