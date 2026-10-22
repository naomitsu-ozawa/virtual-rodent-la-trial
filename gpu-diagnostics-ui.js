// GPU info tab of the settings dialog. DEBUG MODE ONLY: the tab button, its panel and the status-bar click that opens
// it exist only while debug mode is on (settings > デバッグ > 「デバッグモード（?debug と同じ）」, or ?debug in the URL). With debug off
// nothing here touches the page: no attribute on the status bar, no listener on it, and `collect` (the only code that may read
// the GPU: one requestAdapter pass when the app never asked, one throwaway WebGL context) is never called.
// `collect` is injected (gpu-diagnostics-collect.js in the app), so this module imports no GPU / DOM code and tests can load it.
import { settings } from './app-settings.js?v=20261022-build655';
import { tr } from './i18n.js?v=20261022-build655';
import { gpuDiagnosticsVisible, buildGpuReport, gpuBrowserDisabled } from './gpu-diagnostics.js?v=20261022-build655';
export function initGpuDiagnosticsUi({ collect, doc = globalThis.document, isDebug = () => !!settings.debugOn(), events = globalThis } = {}) {
  const dlg = doc?.getElementById?.('settings-dialog'); if (!dlg || typeof collect !== 'function') return null;
  const $ = id => doc.getElementById(id);
  // the workspace UI moves the dialog's tabs / panes out of it (embedded in the 設定 panel), so fall back to the document
  const find = sel => dlg.querySelector(sel) || doc.querySelector?.(sel) || null;
  const tab = find('[data-settings-tab="gpu"]'), panel = find('[data-settings-panel="gpu"]');
  if (!tab) return null;
  const hintEl = $('gpu-hint'), area = $('gpu-report'), msg = $('gpu-copy-msg'), copyBtn = $('gpu-copy'), bar = $('gpu-status-bar');
  const on = () => gpuDiagnosticsVisible(isDebug());

  let seq = 0;
  async function refresh() {
    if (!on()) return;
    const my = ++seq; if (msg) msg.textContent = '';
    let d; try { d = await collect(); } catch (e) { if (area) area.value = String(e?.stack || e); return; }
    if (my !== seq || !on()) return;
    if (area) area.value = buildGpuReport(d, tr);
    if (hintEl) {
      const lines = [];
      if (d.hint) lines.push(d.hint);
      if (gpuBrowserDisabled(d)) lines.push(tr('gpuBrowserOff'));
      if (d.os === 'linux' && d.kind) lines.push(d.kind === 'software' ? tr('gpuHintSw') : tr('gpuHintInt'));
      hintEl.hidden = !lines.length; hintEl.textContent = lines.join('\n'); hintEl.style.whiteSpace = 'pre-wrap';
    }
  }
  if (copyBtn) copyBtn.onclick = async () => {
    if (!on()) return;
    await refresh();
    const text = area?.value || '';
    let ok = false;
    try { await globalThis.navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok && area) { try { area.focus(); area.select(); ok = doc.execCommand?.('copy') === true; } catch {} }
    if (msg) msg.textContent = ok ? tr('gpuCopied') : tr('gpuCopyManual');
    if (!ok && area) { area.focus(); area.select(); }
  };
  tab.addEventListener('click', () => void refresh());

  // the tab opens from the status bar only in debug mode
  const open = () => { if (!on()) return; const o = $('settings-open'); if (o && !dlg.open) o.click(); tab.click(); };
  let barOn = false, barWired = false;
  const onBarClick = () => open();
  const onBarKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  function apply() {
    const show = on();
    tab.hidden = !show; if (panel && !show) panel.hidden = true;
    if (!show && tab.classList.contains('is-active')) find('[data-settings-tab="render"]')?.click();
    if (!bar || show === barOn) return;
    barOn = show;
    if (show) {
      if (!barWired) { barWired = true; bar.addEventListener('click', onBarClick); bar.addEventListener('keydown', onBarKey); }
      bar.setAttribute('role', 'button'); bar.tabIndex = 0; bar.title = tr('settingsTabGpu'); bar.classList.add('is-debug-link');
    } else {
      bar.removeAttribute('role'); bar.removeAttribute('tabindex'); bar.removeAttribute('title'); bar.classList.remove('is-debug-link');
    }
  }
  // the debug switch of the settings dialog toggles live (?debug is fixed for the page, so the first apply() covers it)
  try { events?.addEventListener?.('vrl-settings', e => { if (e?.detail?.key === 'debug') apply(); }); } catch {}
  apply();
  return { apply, refresh, open };
}
