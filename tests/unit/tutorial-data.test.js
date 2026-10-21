import { describe, it, expect } from 'vitest';
import { TUTORIAL_MISSIONS, TUT_SIGNALS, TUT_VOICES, missionById } from '../../docs/tutorial-data.js';
import { I18N } from '../../docs/i18n.js';
import { SAMPLE_SETS } from '../../docs/sample-sets.js';

const steps = TUTORIAL_MISSIONS.flatMap(m => m.steps);
describe('tutorial data', () => {
  it('eight missions m1..m8 in order', () => {
    expect(TUTORIAL_MISSIONS.map(m => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
    expect(missionById('m3').sample).toBe('sample4');
    expect(missionById('x')).toBeNull();
  });
  it('M7 needs AR, M8 is optional and needs analysis labels', () => {
    expect(missionById('m7').requiresAr).toBe(true);
    expect(missionById('m8')).toMatchObject({ optional: true, requiresAnalysis: true });
    expect(TUTORIAL_MISSIONS.filter(m => m.requiresAr || m.optional).map(m => m.id)).toEqual(['m7', 'm8']);
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
    expect(TUT_SIGNALS).toHaveLength(19);
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
    for (const k of ['tutTitle', 'tutNext', 'tutPrev', 'tutSkipMission', 'tutSkipAll', 'tutReset', 'tutResetAgain', 'tutDone', 'tutLocked', 'tutNoAr', 'tutNoAnalysis', 'tutVoiceF1', 'tutVoiceM1'])
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
