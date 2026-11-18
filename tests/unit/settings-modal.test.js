import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

const SRC = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');

// 設定 is one LARGE modal (#settings-dialog) in normal and event mode. The left rail's 設定 entry is a button that opens it (no drawer panel, no tab switching),
// #settings-open (the opener the other code calls) always calls showModal, 最初の状態に戻す sits at the top inside the modal in event mode.
describe('settings-ui: #settings-open always opens the real modal', () => {
  let init;
  beforeAll(async () => { installDomStub(); init = (await importApp('settings-ui')).initSettingsDialog; });
  const el = (id, extra = {}) => ({ id, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], ...extra });
  function fakePage() {
    const calls = [], dlg = el('settings-dialog', { open: false, showModal() { calls.push('showModal'); this.open = true; }, close() { calls.push('close'); this.open = false; } });
    const open = el('settings-open'), close = el('settings-close');
    const byId = { 'settings-dialog': dlg, 'settings-open': open, 'settings-close': close };
    const keys = [];
    const doc = { getElementById: id => byId[id] ?? null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el('x'), body: el('body'), documentElement: el('html') };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { addEventListener: (t, f, c) => keys.push([t, f, c]), removeEventListener() {} });
    return { dlg, open, close, calls, keys };
  }
  it('the click opens it with showModal, even if the old embedded flag is set; an open dialog is not opened twice', () => {
    const p = fakePage(); p.dlg.dataset.embedded = '1'; // the flag of-698: it must be ignored now
    init();
    p.open.onclick();
    expect(p.calls).toEqual(['showModal']);
    p.open.onclick(); // already open: no InvalidStateError
    expect(p.calls).toEqual(['showModal']);
    p.close.onclick();
    expect(p.calls).toEqual(['showModal', 'close']);
    p.open.onclick();
    expect(p.calls).toEqual(['showModal', 'close', 'showModal']); // closing leaves nothing behind: it opens again
  });
  it('while it is open the page behind gets no Escape (window capture listener); closed: the key passes', () => {
    const p = fakePage(); init();
    const [, guard, capture] = p.keys.find(k => k[0] === 'keydown');
    expect(capture).toBe(true);
    const ev = key => ({ key, stopped: false, stopPropagation() { this.stopped = true; } });
    p.dlg.open = true; const a = ev('Escape'), b = ev('ArrowLeft'); guard(a); guard(b);
    expect(a.stopped).toBe(true); expect(b.stopped).toBe(false);
    p.dlg.open = false; const c = ev('Escape'); guard(c);
    expect(c.stopped).toBe(false);
  });
});

describe('設定 > 描画: 重なったラベルの奥側 (labelOverlap, the device setting shared with the VR menu)', () => {
  const shell = SRC('ui-shell.js'), st = SRC('settings-ui.js');
  it('the row is in the 描画 panel with the three modes, and is bound / synced like the other device settings', () => {
    const render = shell.slice(shell.indexOf('data-settings-panel="render"'), shell.indexOf('data-settings-panel="cache"'));
    expect(render).toContain('id="set-label-overlap"');
    for (const v of ['keep', 'always', 'many']) expect(render).toContain('<option value="' + v + '" data-i18n=');
    expect(st).toContain("bind('set-label-overlap','labelOverlap');"); expect(st).toContain("put('set-label-overlap',normalizeLabelOverlap(v.labelOverlap));");
  });
});

describe('the rail 設定 entry and the dialog markup (source)', () => {
  const ws = SRC('workspace-ui.js'), shell = SRC('ui-shell.js'), st = SRC('settings-ui.js'), ev = SRC('event-mode-ui.js'), css = SRC('style.css');
  it('no prefs drawer panel, no embedded settings, no event-tab filter: the 設定 entry is a button that presses #settings-open', () => {
    expect(ws).not.toMatch(/section\('prefs'\)|ws-settings-embed|dataset\.embedded|EVENT_TABS|applyEventMenu|eventOn/);
    expect(ws).not.toMatch(/\['prefs','settingsTitle'/); // not one of the rail's tabs
    expect(ws).toContain("settingsEntry.id='ws-settings-entry'");
    expect(ws).toContain("settingsEntry.onclick=()=>{if(openBtn)openBtn.click();else if(dlg&&!dlg.open)dlg.showModal?.()};");
    expect(ws).not.toMatch(/data-ipad-drawer-tab="prefs"|vrl-settings-sync/);
    expect(ws).toContain("dlgBody.insertBefore(rows,dlgBody.querySelector('.settings-tabs'))"); // 外観 / 言語 at the top of the modal's body
    expect(ws).not.toMatch(/for\(const el of \[\.\.\.dlg\.children\]\)/); // the content is no longer moved out of the dialog
  });
  it('settings-ui: always showModal, nothing about the embedded panel or the prefs tab', () => {
    expect(st).not.toMatch(/embedded|tab:'prefs'/);
    expect(st).toContain('dlg.showModal?dlg.showModal():dlg.setAttribute');
  });
  it('the dialog: head (title, ×) outside a .settings-body that holds the tabs and every pane', () => {
    const d = shell.slice(shell.indexOf('<dialog id="settings-dialog"'), shell.indexOf('</dialog>', shell.indexOf('<dialog id="settings-dialog"')) + 9);
    expect(d.indexOf('id="settings-close"')).toBeLessThan(d.indexOf('<div class="settings-body">'));
    expect(d.indexOf('<div class="settings-body">')).toBeLessThan(d.indexOf('class="settings-tabs"'));
    expect(d.indexOf('data-settings-panel="gpu"')).toBeLessThan(d.indexOf('</div></dialog>'));
    expect(d.endsWith('data-i18n="setSaved"></p></div></dialog>')).toBe(true);
    expect(d.match(/<div class="settings-body">/g)).toHaveLength(1);
  });
  it('event mode: 最初の状態に戻す (same id) goes at the top of the modal body, with the 2-press confirm unchanged', () => {
    expect(ev).toContain("document.querySelector('#settings-dialog .settings-body')");
    expect(ev).toContain('if(host)host.prepend(panel)');
    expect(ev).toContain("resetBtn.id='event-reset-btn'");
    expect(ev).toContain('RESET_ARM_MS');
    expect(ev).not.toMatch(/data-ipad-drawer-section="prefs"/);
  });
  it('style: about 90vw x 90dvh with a width cap, body scrolls inside, laser-sized controls; event mode keeps only the rail entry', () => {
    expect(css).toMatch(/#settings-dialog\{width:min\(90vw,1200px\);[^}]*height:90dvh;[^}]*max-height:calc\(100dvh - 16px\)/);
    expect(css).toContain('#settings-dialog[open]{display:flex;flex-direction:column;overflow:hidden}');
    expect(css).toMatch(/#settings-dialog \.settings-body\{[^}]*flex:1 1 auto;min-height:0;overflow-y:auto/);
    expect(css).toMatch(/#settings-dialog \.settings-head button\{min-width:52px;min-height:52px/);
    expect(css).toMatch(/html\.vrl-event-layout\.vrl-ipad-ui \.sidebar>\.sidebar-scroll,[^{]*\.ws-tool-rail>\[data-ipad-drawer-tab\]\{display:none!important\}/);
    expect(css).not.toContain('ws-settings-embed');
    // the tutorial voice dialog shares .settings-dialog: its size is not touched
    expect(css).toContain('.settings-dialog{width:min(460px,calc(100vw - 32px))');
  });
  it('the event page code that follows the old drawer is gone from the other callers (no caller asks for the prefs tab)', () => {
    for (const f of ['data-load.js', 'inline-ask.js', 'gpu-diagnostics-ui.js', 'app.js']) expect(SRC(f), f).not.toMatch(/tab:\s*'prefs'|requestIPadSettingsTab\('prefs'\)/);
    expect(SRC('gpu-diagnostics-ui.js')).toContain("$('settings-open')"); // still opens the dialog through #settings-open
  });
});
