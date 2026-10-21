// Connects the GPU info tab (gpu-diagnostics-ui.js) to the app: reads gpuFilterRuntime, the settings and the Linux note, and hands
// them to gatherGpuDiagnostics (gpu-diagnostics.js). Called only from the debug-mode GPU info tab, never at start-up.
import { settings } from './app-settings.js?v=20261021-build636';
import { gpuFilterRuntime, gpuForceCompat, GPU_BUFFER_LIMIT_CAPS, requestVrlGpuAdapter, vrlGpuPreference, vrlHybridMode, gpuDeviceMode } from './gpu-compute.js?v=20261021-build636';
import { gpuPlatformOs, gpuPreferenceSupported } from './gpu-preference.js?v=20261021-build636';
import { linuxWebgpuNoteState } from './linux-webgpu-note.js?v=20261021-build636';
import { gatherGpuDiagnostics, collectWebglInfo } from './gpu-diagnostics.js?v=20261021-build636';
import { tr } from './i18n.js?v=20261021-build636';
import { APP_BUILD } from './version.js?v=20261021-build636';
// One requestAdapter pass, made only when the app itself never asked for an adapter. role 'probe' keeps its record apart from the
// compute / render devices' own (gpuFilterRuntime.adapterRequest / renderAdapterRequest).
async function probeAdapter() {
  const adapter = await requestVrlGpuAdapter(vrlGpuPreference(), 'probe');
  return { adapter, request: gpuFilterRuntime.probeAdapterRequest };
}

export function collectGpuDiagnostics() {
  const nav = globalThis.navigator || {};
  return gatherGpuDiagnostics({
    nav, os: gpuPlatformOs(nav), hasGpu: 'gpu' in nav, rt: gpuFilterRuntime, caps: GPU_BUFFER_LIMIT_CAPS, forceCompat: gpuForceCompat, build: APP_BUILD,
    stored: { gpuPreference: settings.get('gpuPreference'), gpuHybridMode: settings.get('gpuHybridMode') },
    effectivePreference: vrlGpuPreference(), effectiveHybrid: vrlHybridMode(), preferenceSupported: gpuPreferenceSupported(nav),
    deviceMode: gpuDeviceMode, probeAdapter, webgl: () => collectWebglInfo(globalThis.document), linuxNote: linuxWebgpuNoteState, tr
  });
}
