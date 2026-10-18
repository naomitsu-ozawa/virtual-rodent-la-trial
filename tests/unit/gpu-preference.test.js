import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { gpuPlatformOs, gpuPreferenceSupported, gpuEffectivePreference, gpuAdapterRequestOptions, gpuPreferenceInfoText, gpuEffectiveHybridMode } from '../../docs/gpu-preference.js';

// build 515: the setting 「使う GPU」 (gpuPreference). Shown and honoured on Linux / Windows only; Mac / iPad stay on 'auto',
// the request the app made before the setting existed.
const nav = (userAgent, platform, maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });
const LINUX = nav('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/155 Safari/537.36', 'Linux x86_64');
const WIN = nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155', 'Win32');
const MAC = nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/155', 'MacIntel');
const IPAD = nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 5);
const IPHONE = nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604', 'iPhone', 5);
const ANDROID = nav('Mozilla/5.0 (Linux; Android 14; Quest 3) Chrome/155 Mobile', 'Linux armv8l', 5);
const CROS = nav('Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) Chrome/155', 'Linux x86_64');

describe('platform gating', () => {
  it('detects the platform (iPadOS reports a Mac, told apart by touch)', () => {
    expect([LINUX, WIN, MAC, IPAD, IPHONE, ANDROID, CROS, {}].map(n => gpuPlatformOs(n))).toEqual(['linux', 'windows', 'mac', 'ios', 'ios', 'android', 'other', 'other']);
  });
  it('the choice is offered on Linux and Windows only', () => {
    expect([LINUX, WIN].map(n => gpuPreferenceSupported(n))).toEqual([true, true]);
    expect([MAC, IPAD, IPHONE, ANDROID, CROS, {}].map(n => gpuPreferenceSupported(n))).toEqual([false, false, false, false, false, false]);
  });
  it('Mac / iPad / others are forced to auto whatever is stored', () => {
    for (const n of [MAC, IPAD, IPHONE, ANDROID, CROS, {}]) for (const s of ['high-performance', 'low-power', 'auto', undefined]) expect(gpuEffectivePreference(s, n)).toBe('auto');
  });
  it('Linux / Windows honour the stored value; anything unknown is auto', () => {
    for (const n of [LINUX, WIN]) {
      expect(gpuEffectivePreference('high-performance', n)).toBe('high-performance');
      expect(gpuEffectivePreference('low-power', n)).toBe('low-power');
      for (const s of ['auto', undefined, null, '', 'turbo', 1]) expect(gpuEffectivePreference(s, n)).toBe('auto');
    }
  });
});

describe('requestAdapter option sets', () => {
  it("'auto' is exactly the request of builds up to 514 (high-performance first)", () => {
    expect(gpuAdapterRequestOptions(false, 'auto')).toEqual([
      { powerPreference: 'high-performance', featureLevel: 'core' }, { powerPreference: 'high-performance' }, undefined,
      { powerPreference: 'high-performance', featureLevel: 'compatibility' }, { featureLevel: 'compatibility' }]);
    expect(gpuAdapterRequestOptions(true, 'auto')).toEqual([{ powerPreference: 'high-performance', featureLevel: 'compatibility' }, { featureLevel: 'compatibility' }]);
    expect(gpuAdapterRequestOptions()).toEqual(gpuAdapterRequestOptions(false, 'auto'));
  });
  it('low-power swaps powerPreference only; the option order is unchanged', () => {
    const a = gpuAdapterRequestOptions(false, 'auto'), l = gpuAdapterRequestOptions(false, 'low-power');
    expect(l.length).toBe(a.length);
    expect(l.map(o => o?.powerPreference)).toEqual(['low-power', 'low-power', undefined, 'low-power', undefined]);
    expect(l.map(o => o?.featureLevel)).toEqual(a.map(o => o?.featureLevel));
  });
  it('high-performance equals auto', () => {
    expect(gpuAdapterRequestOptions(false, 'high-performance')).toEqual(gpuAdapterRequestOptions(false, 'auto'));
  });
});

describe('status fragment', () => {
  const req = (effective, optionIndex = 0, supported = true) => ({ stored: effective, effective, supported, optionIndex });
  it('names the requested preference and the adapter obtained', () => {
    expect(gpuPreferenceInfoText(req('low-power'), { info: { vendor: 'intel', architecture: 'gen-12lp', device: 'x' } })).toBe('GPU pref low-power → intel gen-12lp (request #1)');
    expect(gpuPreferenceInfoText(req('high-performance', 3), { info: { vendor: 'nvidia' } })).toBe('GPU pref high-performance → nvidia (request #4)');
    expect(gpuPreferenceInfoText(req('auto'), { info: {} })).toBe('GPU pref auto → unknown adapter (request #1)');
    expect(gpuPreferenceInfoText(req('auto', -1), null)).toBe('GPU pref auto → no adapter');
  });
  it('is empty where the setting does not apply (Mac / iPad status line unchanged)', () => {
    expect(gpuPreferenceInfoText(req('auto', 0, false), { info: { vendor: 'apple' } })).toBe('');
    expect(gpuPreferenceInfoText(undefined, null)).toBe('');
  });
});

describe('persistence (app-settings)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  const store = init => { const m = new Map(Object.entries(init || {})); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m }; };
  it('defaults to auto and is saved with the other settings', async () => {
    const ls = store(); vi.stubGlobal('localStorage', ls); vi.resetModules();
    const { settings, SETTINGS_DEFAULTS } = await import('../../docs/app-settings.js');
    expect(SETTINGS_DEFAULTS.gpuPreference).toBe('auto');
    expect(settings.get('gpuPreference')).toBe('auto');
    settings.set('gpuPreference', 'low-power');
    expect(JSON.parse(ls.m.get('vrl.settings.v1')).gpuPreference).toBe('low-power');
  });
  it("build 517: 'gpuHybridMode' defaults to hybrid, is saved with the other settings and restored; honoured on Linux only", async () => {
    const ls = store(); vi.stubGlobal('localStorage', ls); vi.resetModules();
    const { settings, SETTINGS_DEFAULTS } = await import('../../docs/app-settings.js');
    expect(SETTINGS_DEFAULTS.gpuHybridMode).toBe('hybrid');
    settings.set('gpuHybridMode', 'primary');
    expect(JSON.parse(ls.m.get('vrl.settings.v1')).gpuHybridMode).toBe('primary');
    vi.resetModules();
    const again = await import('../../docs/app-settings.js');
    expect(again.settings.get('gpuHybridMode')).toBe('primary');
    expect(gpuEffectiveHybridMode(again.settings.get('gpuHybridMode'), LINUX)).toBe('primary');
    for (const n of [WIN, MAC, IPAD, ANDROID, CROS]) expect(gpuEffectiveHybridMode('primary', n)).toBe('hybrid');
  });
  it('is restored on the next start', async () => {
    vi.stubGlobal('localStorage', store({ 'vrl.settings.v1': JSON.stringify({ gpuPreference: 'high-performance' }) })); vi.resetModules();
    const { settings } = await import('../../docs/app-settings.js');
    expect(settings.get('gpuPreference')).toBe('high-performance');
    expect(gpuEffectivePreference(settings.get('gpuPreference'), LINUX)).toBe('high-performance');
    expect(gpuEffectivePreference(settings.get('gpuPreference'), MAC)).toBe('auto');
  });
});

describe('settings dialog markup / i18n', () => {
  const shell = readFileSync('docs/ui-shell.js', 'utf8'), i18n = readFileSync('docs/i18n.js', 'utf8'), ui = readFileSync('docs/settings-ui.js', 'utf8');
  it('the row, the select and the reload hint exist in the render panel, hidden until shown', () => {
    expect(shell).toMatch(/<label id="gpu-pref-row" class="settings-row" hidden>/);
    expect(shell).toMatch(/<select id="set-gpu-preference"[^>]*><option value="auto"[^>]*><\/option><option value="high-performance"[^>]*><\/option><option value="low-power"/);
    expect(shell).toMatch(/<p id="gpu-pref-reload" class="hint" hidden>/);
    const render = shell.slice(shell.indexOf('data-settings-panel="render"'), shell.indexOf('data-settings-panel="cache"'));
    expect(render).toContain('id="set-gpu-preference"');
  });
  it('every i18n key used exists in both ja and en', () => {
    const keys = ['gpuPrefLabel', 'gpuPrefAuto', 'gpuPrefHigh', 'gpuPrefLow', 'gpuPrefReload', 'gpuReloadBtn'];
    for (const k of keys) expect([...i18n.matchAll(new RegExp('[{,\\s]' + k + ':', 'g'))].length).toBe(2);
    for (const m of shell.matchAll(/data-i18n="(gpuPref[A-Za-z]*|gpuReloadBtn)"/g)) expect(keys).toContain(m[1]);
  });
  it('the dialog wires the select to the setting, shows the reload note on a change, and hides the row off Linux / Windows', () => {
    expect(ui).toContain('gpuRow.hidden=!gpuPreferenceSupported()');
    expect(ui).toContain("settings.set('gpuPreference',gpuSel.value)");
    expect(ui).toContain('gpuReload.hidden=gpuSel.value===loadedGpuPref');
  });
});
