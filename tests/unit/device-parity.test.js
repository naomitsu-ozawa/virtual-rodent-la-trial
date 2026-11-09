import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { isIPadRuntime, isTabletRuntime, isDesktopRuntime, isMacPlatformRuntime, isMobileOsUserAgent, isVrHeadsetRuntime } from '../../docs/utils.js';

// Device parity (design rule): a feature is never removed by device type; a device may only get a smaller numeric memory / size cap.
const SRC = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const UA = {
  pc: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Win32', 0],
  ipad: ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'iPad', 5],
  ipadDesktopUa: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 'MacIntel', 5],
  quest: ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 OculusBrowser/35.0 Chrome/126 VR Mobile Safari/537.36 Quest 3', 'Linux x86_64', 5],
  mac: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 'MacIntel', 0],
};
const setNav = ([userAgent, platform, maxTouchPoints]) => Object.defineProperty(globalThis, 'navigator', { value: { userAgent, platform, maxTouchPoints }, configurable: true });
// state.js / gpu-volume-data.js need a DOM: their pure pieces are taken from the source and run against the stubbed navigator
let side = 512;
const setIpadGpuTargetSide = v => { side = v; };
const normalizeGpuSide = new Function(`return (${/export const normalizeGpuSide=([^\n]*);/.exec(SRC('state.js'))[1]})`)();
const planSrc = SRC('gpu-volume-data.js');
const gpuVolumePlanOptions = () => new Function('isTabletRuntime', 'ipadGpuTargetSide',
  `return (${planSrc.slice(planSrc.indexOf('function gpuVolumePlanOptions'), planSrc.indexOf('\n}', planSrc.indexOf('function gpuVolumePlanOptions')) + 2)})()`)(isTabletRuntime, side);
const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
afterEach(() => { if (orig) Object.defineProperty(globalThis, 'navigator', orig); else delete globalThis.navigator; setIpadGpuTargetSide(512); });

describe('device detection lives in utils.js', () => {
  it('classifies PC, iPad (also with the desktop UA), Quest and Mac', () => {
    setNav(UA.pc); expect([isDesktopRuntime(), isTabletRuntime(), isMacPlatformRuntime()]).toEqual([true, false, false]);
    setNav(UA.ipad); expect([isIPadRuntime(), isTabletRuntime(), isDesktopRuntime()]).toEqual([true, true, false]);
    setNav(UA.ipadDesktopUa); expect([isIPadRuntime(), isTabletRuntime(), isMacPlatformRuntime()]).toEqual([true, true, true]);
    setNav(UA.quest); expect([isTabletRuntime(), isVrHeadsetRuntime(), isMobileOsUserAgent()]).toEqual([true, true, true]);
    setNav(UA.mac); expect([isDesktopRuntime(), isIPadRuntime(), isMacPlatformRuntime()]).toEqual([true, false, true]);
  });
  it('no module outside utils.js tests navigator.platform or names a platform in a userAgent regex of its own (gpu-preference / linux note / diagnostics report the OS and are not feature gates)', () => {
    expect(SRC('data-load.js')).not.toMatch(/navigator\.platform|\/Mac\//);
    expect(SRC('state.js')).not.toMatch(/navigator\.(userAgent|platform)|Android\|OculusBrowser/);
    expect(SRC('utils.js')).toContain('export function isMacPlatformRuntime');
  });
});

describe('features are not removed by device type', () => {
  it('GPU volume quality: the full-size option is never removed by device type; no iPhone branch is left', () => {
    const src = SRC('workspace-ui.js'), fn = src.slice(src.indexOf('export function initIPadGpuQualityControl'), src.indexOf('ipadGpuQuality.onchange'));
    expect(fn).not.toMatch(/isTabletRuntime|\.remove\(\)/);
    expect(fn).not.toMatch(/isIPhoneRuntime|iPhone/);
    expect(src).not.toMatch(/isTabletRuntime/);
  });
  it('the stored / chosen size: 768 and full (0) are honoured on every device, anything else is 512', () => {
    expect([normalizeGpuSide(768), normalizeGpuSide(0), normalizeGpuSide(512), normalizeGpuSide(NaN), normalizeGpuSide(300)]).toEqual([768, 0, 512, 512, 512]);
    expect(SRC('state.js')).toContain('ipadGpuTargetSide=normalizeGpuSide(');
  });
  it('plan options: no new cap is invented; the iPhone 96 MiB cap is gone with the iPhone branch; the chosen size applies on PC / tablet / Quest', () => {
    setNav(UA.pc); setIpadGpuTargetSide(0); expect(gpuVolumePlanOptions()).toEqual({ maxTextureBytes: 0, targetInPlane: 0 });
    setNav(UA.ipad); expect(gpuVolumePlanOptions()).toEqual({ maxTextureBytes: 0, targetInPlane: 0 }); // full on a tablet: selectable, existing caps only
    setNav(UA.quest); expect(gpuVolumePlanOptions().targetInPlane).toBe(0);
    setIpadGpuTargetSide(512); setNav(UA.ipad); expect(gpuVolumePlanOptions()).toEqual({ maxTextureBytes: 0, targetInPlane: 512 });
    setIpadGpuTargetSide(768); setNav(UA.ipad); expect(gpuVolumePlanOptions()).toEqual({ maxTextureBytes: 0, targetInPlane: 768 });
    expect(planSrc).not.toContain('TABLET_FULL_TEXTURE_BYTES');
  });
  it('the kept device branches are numeric caps only (memory / size)', () => {
    expect(SRC('volume-io.js')).toMatch(/if\(isTabletRuntime\(\)\)return 1536\*1024\*1024/);
    expect(SRC('source-filters.js')).toContain('isTabletRuntime()?192*1024*1024:256*1024*1024');
    expect(SRC('mpr-orthogonal.js')).toContain('isTabletRuntime()?256*1024*1024:512*1024*1024');
  });
});

describe('iPhone and the classic UI are gone (iPhone is no longer a target)', () => {
  const FILES = ['app.js', 'data-load.js', 'workspace-ui.js', 'utils.js', 'gpu-volume-data.js', 'volume-io.js', 'source-filters.js', 'mpr-orthogonal.js', 'ui-shell.js', 'inline-ask.js', 'scene-view.js', 'comment-ui.js', 'comment-3d.js'];
  it('no iPhone-specific code and no UI switch is left in the modules', () => {
    for (const f of FILES) { const src = SRC(f); expect(src, f).not.toMatch(/isIPhoneRuntime|useWorkspaceUi|ui=classic|sample-dialog|sampleDialog/); }
    expect(SRC('utils.js')).not.toContain('iPhone');
  });
  it('the practice-data choices are built once in a hidden holder and moved into the データ panel; no dialog fallback', () => {
    expect(SRC('ui-shell.js')).toContain('id="sample-choices-holder" hidden');
    expect(SRC('workspace-ui.js')).toContain("#sample-choices-holder .sample-choices");
  });
  it('isDesktopRuntime = no touch input; the caps of tablets / mobile stay (volume 1536, source slices 192, orthogonal 256 MiB)', () => {
    setNav(['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5]); expect([isDesktopRuntime(), isTabletRuntime()]).toEqual([false, false]);
    setNav(UA.pc); expect(isDesktopRuntime()).toBe(true);
  });
});
