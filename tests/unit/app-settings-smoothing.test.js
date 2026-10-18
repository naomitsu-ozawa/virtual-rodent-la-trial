import { describe, it, expect, vi, afterEach } from 'vitest';

// The device default of the surface smoothing (strength + enabled). The project file stays the primary store; this entry only
// fills in at start and for data / projects without a saved value.
async function load(stored) {
  vi.resetModules();
  const store = new Map(stored === undefined ? [] : [['vrl.settings.v1', JSON.stringify(stored)]]);
  vi.stubGlobal('localStorage', { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
  return { mod: await import('../../docs/app-settings.js'), store };
}
afterEach(() => vi.unstubAllGlobals());

describe('surface smoothing device default', () => {
  it('defaults to the slider markup: enabled, 0.60', async () => {
    const { mod } = await load();
    expect(mod.SETTINGS_DEFAULTS.surfaceSmooth).toBe(true);
    expect(mod.SETTINGS_DEFAULTS.surfaceSmoothStrength).toBe('0.60');
    expect(mod.settings.get('surfaceSmoothStrength')).toBe('0.60');
  });
  it('is stored and read back after a reload', async () => {
    const { mod, store } = await load();
    mod.settings.set('surfaceSmooth', false);
    mod.settings.set('surfaceSmoothStrength', '3');
    expect(JSON.parse(store.get('vrl.settings.v1'))).toMatchObject({ surfaceSmooth: false, surfaceSmoothStrength: '3' });
    const again = await load(JSON.parse(store.get('vrl.settings.v1')));
    expect(again.mod.settings.get('surfaceSmooth')).toBe(false);
    expect(again.mod.settings.get('surfaceSmoothStrength')).toBe('3');
  });
  it('settings saved before the entry existed keep working (default fills in)', async () => {
    const { mod } = await load({ gpuSide: 768 });
    expect(mod.settings.get('gpuSide')).toBe(768);
    expect(mod.settings.get('surfaceSmoothStrength')).toBe('0.60');
  });
});
