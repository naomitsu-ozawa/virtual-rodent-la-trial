// GPU preference ("使う GPU", build 515): which GPU the WebGPU adapter request asks for. Pure, no imports, so it can be
// loaded by unit tests without a DOM. The choice is offered (and honoured) only on Linux / Windows desktops, where a
// machine can have two GPUs (integrated + NVIDIA / AMD). Mac, iPad, phones and anything else always stay on 'auto',
// which is exactly the request the app made before this setting existed.

// 'linux' | 'windows' | 'mac' | 'ios' | 'android' | 'other'. iPadOS reports a Macintosh UA, told apart by touch.
export function gpuPlatformOs(nav = globalThis.navigator) {
  try {
    const ua = String(nav?.userAgent || ''), p = String(nav?.userAgentData?.platform || nav?.platform || '');
    const touch = Number(nav?.maxTouchPoints) > 1;
    if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(p + ua) && touch)) return 'ios';
    if (/Android/i.test(ua) || /^Android$/i.test(p)) return 'android';
    if (/CrOS/.test(ua)) return 'other';
    if (/^mac/i.test(p) || /Macintosh|Mac OS X/.test(ua)) return 'mac';
    if (/^win/i.test(p) || /Windows/.test(ua)) return 'windows';
    if (/linux|x11/i.test(p) || /Linux|X11/.test(ua)) return 'linux';
  } catch {}
  return 'other';
}
// The setting row is shown only here, and the stored value is only honoured here.
export function gpuPreferenceSupported(nav = globalThis.navigator) {
  const os = gpuPlatformOs(nav);
  return os === 'linux' || os === 'windows';
}
// 'auto' | 'high-performance' | 'low-power'; the stored value is ignored where the choice is not supported.
export function gpuEffectivePreference(stored, nav = globalThis.navigator) {
  if (!gpuPreferenceSupported(nav)) return 'auto';
  return stored === 'high-performance' || stored === 'low-power' ? stored : 'auto';
}

// requestAdapter option sets, tried in order. 'auto' is the historical list (high-performance first, identical to the
// requests of builds up to 514); an explicit preference only swaps the powerPreference that is asked for.
export function gpuAdapterRequestOptions(forceCompat = false, preference = 'auto') {
  const pp = preference === 'low-power' ? 'low-power' : 'high-performance';
  const hp = { powerPreference: pp };
  return [...(forceCompat ? [] : [{ ...hp, featureLevel: 'core' }, hp, undefined]), { ...hp, featureLevel: 'compatibility' }, { featureLevel: 'compatibility' }];
}

// One status-bar fragment: what was asked for and which adapter came back (vendor / architecture). '' on platforms where
// the setting does not apply, so the Mac / iPad status line is unchanged.
export function gpuPreferenceInfoText(requested, adapter) {
  if (!requested?.supported) return '';
  const info = (() => { try { return adapter?.info || null; } catch { return null; } })();
  const got = adapter ? ([info?.vendor, info?.architecture].filter(Boolean).map(v => String(v).trim()).filter(Boolean).join(' ') || 'unknown adapter') : 'no adapter';
  return 'GPU pref ' + requested.effective + ' → ' + got + (adapter && requested.optionIndex >= 0 ? ' (request #' + (requested.optionIndex + 1) + ')' : '');
}

// The setting 「ハイブリッド環境での処理」 (build 517): what the app does on a Linux machine with an Intel display GPU and an
// NVIDIA GPU (the hybrid case of gpu-split.js). 'hybrid' (default) = render on the display GPU, compute on NVIDIA (the split of
// build 516); 'primary' = everything on the primary (display, low-power) GPU, one shared device as on a one-GPU machine.
// The row is shown on Linux only and the stored value is ignored everywhere else (Mac, iPad, Windows, Android: 'hybrid', i.e.
// nothing changes); it only has an effect where the hybrid case is detected (a single-GPU machine ignores it).
export function gpuHybridModeSupported(nav = globalThis.navigator) {
  return gpuPlatformOs(nav) === 'linux';
}
export function gpuEffectiveHybridMode(stored, nav = globalThis.navigator) {
  return gpuHybridModeSupported(nav) && stored === 'primary' ? 'primary' : 'hybrid';
}
