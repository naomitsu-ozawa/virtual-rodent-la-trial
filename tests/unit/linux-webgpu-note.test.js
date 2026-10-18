import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { I18N } from '../../docs/i18n.js';
import { isLinuxUserAgent, shouldShowLinuxWebgpuNote } from '../../docs/linux-webgpu-note.js';

const UA = {
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
};

describe('Linux WebGPU launch-option note', () => {
  it('shows on Linux when navigator.gpu is missing', () => {
    expect(shouldShowLinuxWebgpuNote({ ua: UA.linux, hasGpu: false, adapterNull: false })).toBe(true);
  });
  it('shows on Linux when requestAdapter returned null for every attempt', () => {
    expect(shouldShowLinuxWebgpuNote({ ua: UA.linux, hasGpu: true, adapterNull: true })).toBe(true);
  });
  it('does not show on Linux when WebGPU works or is still being probed', () => {
    expect(shouldShowLinuxWebgpuNote({ ua: UA.linux, hasGpu: true, adapterNull: false })).toBe(false);
    expect(shouldShowLinuxWebgpuNote({ ua: UA.linux, hasGpu: true, adapterNull: null })).toBe(false);
  });
  it('never shows on Mac / iPad / Windows / Android', () => {
    for (const k of ['mac', 'ipad', 'win', 'android'])
      for (const hasGpu of [true, false])
        expect(shouldShowLinuxWebgpuNote({ ua: UA[k], hasGpu, adapterNull: true })).toBe(false);
    expect(isLinuxUserAgent(UA.android)).toBe(false);
  });
  it('has ja and en text that names the option and not chrome://flags', () => {
    for (const l of ['ja', 'en']) {
      expect(I18N[l].linuxGpuNote).toBeTruthy();
      expect(I18N[l].linuxGpuNoteText).toContain('--enable-features=ForceEnableWebGpuInterop');
      expect(I18N[l].linuxGpuNoteText).not.toContain('chrome://flags');
    }
  });
  it('is hooked from updateGpuStatus with a single call', () => {
    const src = readFileSync('docs/gpu-compute.js', 'utf8');
    expect(src.match(/updateLinuxWebgpuNote\(\)/g)).toHaveLength(1);
  });
});
