import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEBUG_SWITCHES, DEBUG_SETTING_DEFAULTS, debugFlag, effectiveFlag, resetDebugFlags } from '../../docs/debug-flags.js';
import { SETTINGS_DEFAULTS } from '../../docs/app-settings.js';
import { I18N } from '../../docs/i18n.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

describe('debug switch: the one 16-bit VR rendering test', () => {
  it('is the only switch, off by default, and exists in the settings defaults', () => {
    expect(DEBUG_SWITCHES.map(d => d.id)).toEqual(['vrMediump']);
    expect(debugFlag('vrMediump', mem())).toBe(false);
    expect(SETTINGS_DEFAULTS.vrMediump).toBe(false);
    expect(DEBUG_SETTING_DEFAULTS).toEqual({ vrMediump: false });
  });
  it('reads the settings JSON; broken JSON and unknown ids are off', () => {
    expect(debugFlag('vrMediump', mem({ 'vrl.settings.v1': JSON.stringify({ vrMediump: true }) }))).toBe(true);
    expect(debugFlag('vrMediump', mem({ 'vrl.settings.v1': '{broken' }))).toBe(false);
    expect(debugFlag('meshCacheOff', mem({ 'vrl.settings.v1': JSON.stringify({ meshCacheOff: true }) }))).toBe(false);
  });
  it('the URL parameter wins (on) whatever is stored; without it the stored value decides', () => {
    const on = mem({ 'vrl.settings.v1': JSON.stringify({ vrMediump: true }) }), off = mem();
    expect(effectiveFlag('vrMediump', false, on)).toBe(true);
    expect(effectiveFlag('vrMediump', false, off)).toBe(false);
    expect(effectiveFlag('vrMediump', true, off)).toBe(true);
  });
  it('reset goes back through setSetting', () => {
    const calls = {};
    resetDebugFlags((k, v) => { calls[k] = v; });
    expect(calls).toEqual({ vrMediump: false });
  });
});

describe('call sites and texts', () => {
  const src = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('vr-view still reads its URL parameter and ORs the stored switch; the other diagnostics are untouched URL / legacy ones', () => {
    expect(src('vr-view.js')).toMatch(/effectiveFlag\('vrMediump',[^)]*vrprec=mediump/);
    expect(src('mesh-cache-apply.js')).not.toContain('effectiveFlag');
    expect(src('smooth-gpu.js')).not.toContain('effectiveFlag');
    expect(src('gpu-compute.js')).not.toContain('effectiveFlag');
  });
  it('labels exist in both languages, and no text carries a link or a URL parameter', () => {
    const bad = /https?:|ui=|build=/i;
    const keys = ['dbgTitle', 'dbgGroupLight', 'dbgVrPrec', 'dbgVrPrecNote', 'dbgReloadNote', 'dbgReload', 'dbgReset', 'dbgApplyReload'];
    for (const k of keys) for (const lang of ['ja', 'en']) { expect(I18N[lang][k], `${lang}.${k}`).toBeTruthy(); expect(I18N[lang][k]).not.toMatch(bad); }
  });
});
