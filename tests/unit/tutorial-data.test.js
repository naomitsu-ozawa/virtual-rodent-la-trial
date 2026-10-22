import { describe, it, expect } from 'vitest';
import { TUTORIAL_MISSIONS, TUT_SIGNALS, TUT_VOICES, TUT_FEEDBACK, missionById } from '../../docs/tutorial-data.js';
import { I18N } from '../../docs/i18n.js';
import { SAMPLE_SETS } from '../../docs/sample-sets.js';

const steps = TUTORIAL_MISSIONS.flatMap(m => m.steps);
describe('tutorial data', () => {
  it('seven steps m1..m7 in order (ステップ1..7); no analysis step', () => {
    expect(TUTORIAL_MISSIONS.map(m => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    expect(missionById('m3').sample).toBe('sample4');
    expect(missionById('x')).toBeNull();
    expect(missionById('m8')).toBeNull();
    expect(TUTORIAL_MISSIONS.some(m => m.requiresAnalysis || m.steps.some(s => ['trigger-label', 'label-show'].includes(s.done.signal)))).toBe(false);
  });
  it('M7 (AR) is the only step with a device requirement; none is optional', () => {
    expect(missionById('m7').requiresAr).toBe(true);
    expect(TUTORIAL_MISSIONS.filter(m => m.requiresAr || m.optional).map(m => m.id)).toEqual(['m7']);
    expect(TUTORIAL_MISSIONS.some(m => m.optional)).toBe(false);
  });
  it('every step practises on sample4 (骨梁 Lv0)', () => {
    expect(TUTORIAL_MISSIONS.map(m => m.sample)).toEqual(Array(7).fill('sample4'));
  });
  it('ids are unique (missions, steps, audio)', () => {
    for (const list of [TUTORIAL_MISSIONS.map(m => m.id), steps.map(s => s.id), steps.map(s => s.audio)]) expect(new Set(list).size).toBe(list.length);
  });
  it('samples are bundled practice datasets', () => {
    for (const m of TUTORIAL_MISSIONS) expect(SAMPLE_SETS[m.sample], m.id).toBeTruthy();
  });
  it('every title / text / hint key exists in ja and en', () => {
    const keys = [];
    for (const m of TUTORIAL_MISSIONS) { keys.push(m.title); for (const s of m.steps) keys.push(s.text, ...Object.values(s.hint || {})); }
    for (const k of keys) for (const l of ['ja', 'en']) expect(I18N[l][k], `${l}:${k}`).toBeTruthy();
  });
  it('hint variants are only ctrl / hand; hand texts carry no diagram characters', () => {
    for (const s of steps) {
      expect(Object.keys(s.hint || {}).every(k => k === 'ctrl' || k === 'hand'), s.id).toBe(true);
      if (s.hint?.hand) expect(I18N.ja[s.hint.hand]).not.toMatch(/[→↑↓←▶◀]|<img|\.svg/);
    }
  });
  it('every done.signal is a known kind; TUT_SIGNALS has no unused kinds (vr-start is reserved)', () => {
    expect(new Set(TUT_SIGNALS).size).toBe(TUT_SIGNALS.length);
    for (const s of steps) expect(TUT_SIGNALS, s.id).toContain(s.done.signal);
    expect([...TUT_SIGNALS].filter(k => k !== 'vr-start').sort()).toEqual([...new Set(steps.map(s => s.done.signal))].sort()); // vr-start fires but no step waits for it
    expect(TUT_SIGNALS).toHaveLength(17);
    expect(TUT_SIGNALS).not.toContain('trigger-label'); expect(TUT_SIGNALS).not.toContain('label-show');
  });
  it('steps are well formed (count >= 1, audio script, timeout)', () => {
    for (const s of steps) {
      expect(Number.isInteger(s.done.count) && s.done.count >= 1, s.id).toBe(true);
      expect(s.audioText.length, s.id).toBeGreaterThan(3);
      expect(s.audioText, s.id).not.toMatch(/VR|AR|CT/); // spelled out in kana for TTS
      expect(s.timeoutHint).toBeGreaterThan(0);
    }
    expect(missionById('m6').steps[0].done).toEqual({ signal: 'point-record', count: 2 });
  });
  it('voices and the data are frozen', () => {
    expect(TUT_VOICES).toEqual(['F1']);
    expect(() => { 'use strict'; TUTORIAL_MISSIONS[0].steps[0].id = 'z'; }).toThrow();
  });
  it('ui keys exist in both languages', () => {
    for (const k of ['tutTitle', 'tutNext', 'tutPrev', 'tutSkipMission', 'tutSkipAll', 'tutReset', 'tutResetAgain', 'tutDone', 'tutLocked', 'tutNoAr', 'tutVoiceF1', 'tutVoiceM1', 'tutStepWord', 'tutPanelList', 'tutPanelDetail', 'tutMissionDone', 'tutAllDone', 'tutFbMissionClear'])
      for (const l of ['ja', 'en']) expect(I18N[l][k], `${l}:${k}`).toBeTruthy();
  });
});

describe('tutorial texts stay short (spoken in about 3-4 s)', () => {
  it('ja body / hints <= 25 chars, audioText <= 25 chars', () => {
    for (const s of steps) {
      for (const k of [s.text, ...Object.values(s.hint || {})]) expect(I18N.ja[k].length, k).toBeLessThanOrEqual(25);
      expect(s.audioText.length, s.id).toBeLessThanOrEqual(25);
    }
  });
});

describe('ステップ wording', () => {
  it('the user-facing step texts say ステップ / Step, not ミッション / Mission; the 体験会 wording is untouched', () => {
    const jaKeys = { tutSkipMission: 'このステップをスキップ', tutLocked: '前のステップを終えると開きます', tutMissionDone: 'ステップ完了', tutAllDone: 'すべてのステップが終わりました', tutFbMissionClear: 'ステップクリアです。', tutStepWord: 'ステップ' };
    for (const [k, v] of Object.entries(jaKeys)) expect(I18N.ja[k], k).toBe(v);
    expect(I18N.ja.setTutorialNote).toContain('ステップ一覧と手順カード');
    expect(I18N.en.tutFbMissionClear).toBe('Step clear.'); expect(I18N.en.tutStepWord).toBe('Step'); expect(I18N.en.tutSkipMission).toBe('Skip this step');
    for (const l of ['ja', 'en']) for (const k of Object.keys(I18N[l]).filter(k => k.startsWith('tut'))) expect(I18N[l][k], `${l}:${k}`).not.toMatch(/ミッション|[Mm]ission/);
    expect(I18N.ja.evMissionCap).toBe('ミッション'); expect(I18N.en.evMissionCap).toBe('Mission');
    expect(I18N.ja.tutPanelList).toBe('手順一覧'); expect(I18N.ja.tutPanelDetail).toBe('詳細'); expect(I18N.en.tutPanelList).toBe('Steps'); expect(I18N.en.tutPanelDetail).toBe('Details');
    expect(TUT_FEEDBACK.missionClear.audioText).toBe('ステップクリアです。');
    for (const l of ['ja', 'en']) for (const k of Object.keys(I18N[l]).filter(k => /^tutM8|^tutNoAnalysis$/.test(k))) expect(k).toBe(null);
  });
});
