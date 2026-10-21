import { gpuPlatformOs } from './gpu-preference.js?v=20261021-build638';

// 'nvidia' | 'intel' | 'amd' | 'apple' | 'software' | 'other' | '' (unknown). `parts` are the strings that name the GPU:
// adapter.info.vendor / architecture / device / description, or the WebGL UNMASKED_VENDOR / UNMASKED_RENDERER.
export function gpuVendorKey(...parts) {
  const s = parts.flat().filter(v => v !== undefined && v !== null).map(v => String(v)).join(' ').toLowerCase();
  if (!s.trim()) return '';
  if (/swiftshader|llvmpipe|softpipe|software|lavapipe/.test(s)) return 'software';
  if (/nvidia|geforce|quadro|\brtx\b|\bgtx\b/.test(s)) return 'nvidia';
  if (/\bintel\b|\biris\b|uhd graphics|hd graphics/.test(s)) return 'intel';
  if (/\bamd\b|\bati\b|radeon|advanced micro/.test(s)) return 'amd';
  if (/apple/.test(s)) return 'apple';
  return 'other';
}
export function gpuAdapterVendorKey(adapter) {
  try {
    const i = adapter?.info;
    return i ? gpuVendorKey(i.vendor, i.architecture, i.device, i.description) : '';
  } catch { return ''; }
}

// Decide whether to split. Inputs are plain values so tests can feed every combination:
//   os            gpuPlatformOs() result
//   computeVendor vendor key of the adapter the compute device is on (per 「使う GPU」 / the limit ladder)
//   lowPowerVendor vendor key of the adapter requestAdapter({powerPreference:'low-power'}) returned
//   displayVendor vendor key of the GPU WebGL renders on (WEBGL_debug_renderer_info) = Chrome's display / GL GPU
// A low-power adapter is NOT proof of the display GPU (the monitor may be wired to the NVIDIA port), hence the WebGL
// probe: split only when the display GPU and the low-power adapter are both Intel and the compute adapter is NVIDIA.
export function gpuSplitDecision({ os, computeVendor = '', lowPowerVendor = '', displayVendor = '' } = {}) {
  const no = reason => ({ split: false, reason, renderVendor: '', computeVendor });
  if (os !== 'linux') return no('not linux');
  if (computeVendor !== 'nvidia') return no('compute adapter is not nvidia');
  if (!displayVendor) return no('display gpu unknown');
  if (displayVendor !== 'intel') return no('display gpu is not intel');
  if (lowPowerVendor !== 'intel') return no('low-power adapter is not intel');
  return { split: true, reason: 'display intel, compute nvidia', renderVendor: 'intel', computeVendor };
}

// A cheap pre-check that needs no GPU access at all: only a Linux machine whose compute adapter is NVIDIA can be in the
// hybrid case, so every other machine returns here before any extra adapter request or WebGL context.
export function gpuSplitCandidate(nav, computeAdapter) {
  return gpuPlatformOs(nav) === 'linux' && gpuAdapterVendorKey(computeAdapter) === 'nvidia';
}

// A compute label that really names the volume renderer (WEBGPU VOLUME RESIDENT / RAYCAST / PICK / <profile> VOLUME · LINEAR):
// that work runs on the render device, never on the compute device. Failure labels are not volume labels.
export function gpuIsVolumeLabel(label) {
  const s = String(label || '');
  return /^WEBGPU\b/.test(s) && /\bVOLUME\b/.test(s) && !/FAIL|ERROR|LOST/.test(s);
}

// The status-line wording. Empty parts when not split, so the single-GPU line is unchanged.
//   split          gpuFilterRuntime.split ({active, renderVendor, computeVendor})
//   computeLabel   the backend label (gpuFilterRuntime.lastBackend)
//   primaryVendor: vendor of the one GPU in the 'primary' hybrid mode ('' otherwise)
// In split mode a volume label is on the display GPU: "Volume WEBGPU RESIDENT intel (display)", not "Compute ... nvidia (split)".
export function gpuSplitStatusParts(split, computeLabel = '', primaryVendor = '') {
  const same = { computeName: 'Compute', computeLabel };
  if (primaryVendor && !split?.active) return { render: ' ' + primaryVendor + ' (primary)', compute: ' ' + primaryVendor + ' (primary)', ...same };
  if (!split?.active) return { render: '', compute: '', ...same };
  const render = ' ' + split.renderVendor + ' (display)';
  if (gpuIsVolumeLabel(computeLabel)) return { render, compute: ' ' + split.renderVendor + ' (display)', computeName: 'Volume', computeLabel: String(computeLabel).replace(/ VOLUME\b/, '') };
  return { render, compute: ' ' + split.computeVendor + ' (split)', ...same };
}

// The hybrid-mode sentence of the bar under the views ('' when the machine is not a detected hybrid).
export function gpuHybridStatusText(rt) {
  if (rt?.hybridMode === 'primary') return 'hybrid mode: primary GPU only (display + compute on ' + (rt.hybridVendor || 'the display GPU') + ')';
  if (rt?.split?.active) return 'hybrid mode: hybrid (display ' + rt.split.renderVendor + ' · compute ' + rt.split.computeVendor + ')';
  return '';
}

// Whether the status shows the extra diagnostics (limits, GPU preference, split / hybrid notes, the long error). Only when
// something out of the ordinary happened: a buffer-limit retry, a detected hybrid (split active, the display-Intel /
// compute-NVIDIA pre-check passed, or the primary-GPU mode), an explicit GPU preference, or debug mode. A Mac / iPad /
// single-GPU machine in its normal state keeps exactly the status text of builds up to 515.
export function gpuStatusDetailed(rt, debug = false) {
  if (debug) return true;
  if (!rt) return false;
  if ((rt.limitRetries || 0) > 0 || (rt.renderLimitRetries || 0) > 0) return true;
  if (rt.split?.active || rt.hybridSeen || rt.hybridMode) return true;
  const req = rt.adapterRequest;
  return !!(req?.supported && req.effective && req.effective !== 'auto');
}

// The display GPU as WebGL sees it: a throwaway WebGL2 context, read once, then released. null when it cannot be read.
// `doc` is injectable for tests.
export function webglDisplayGpu(doc = globalThis.document) {
  let canvas = null, gl = null;
  try {
    canvas = doc?.createElement?.('canvas');
    if (!canvas) return null;
    canvas.width = canvas.height = 1;
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : '', renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (!vendor && !renderer) return null;
    return { vendor: String(vendor || ''), renderer: String(renderer || '') };
  } catch { return null; } finally {
    try { gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.(); } catch {}
  }
}
