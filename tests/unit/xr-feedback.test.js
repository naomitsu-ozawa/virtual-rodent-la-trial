import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createXrFeedback } from '../../docs/xr-feedback.js';

// busy state of the VR / AR buttons + a status line from the press until the session is shown
const el = (i18n, text) => {
  const attrs = new Map(i18n ? [['data-i18n', i18n]] : []);
  return {
    disabled: false, textContent: text, dataset: {},
    getAttribute: k => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, String(v)), removeAttribute: k => attrs.delete(k), has: k => attrs.has(k),
  };
};
const I18N = {
  vrView: 'VRで見る', arView: 'ARで見る', vrBtnBusy: '準備中…', vrBtnStarting: '起動中…', vrBtnRunning: '表示中',
  vrStepLoading: '{m}の機能を読み込んでいます…', vrStepPrepare: '{m}の準備中: {t}', vrStepStarting: '{m}を起動しています', vrStepRunning: '{m}表示中',
};
const setup = () => {
  const vr = el('vrView', 'VRで見る'), ar = el('arView', 'ARで見る'), footer = { textContent: 'ready' };
  const fb = createXrFeedback({ buttons: [vr, ar], footer, tr: k => I18N[k] ?? k });
  return { vr, ar, footer, fb };
};

describe('xr feedback', () => {
  it('shows the busy state at once and disables both buttons against a double press', () => {
    const { vr, ar, footer, fb } = setup();
    fb.set('loading', { button: vr, mode: 'vr' });
    expect(vr.disabled).toBe(true); expect(ar.disabled).toBe(true);
    expect(vr.textContent).toBe('準備中…'); expect(ar.textContent).toBe('ARで見る');
    expect(vr.getAttribute('aria-busy')).toBe('true');
    expect(footer.textContent).toBe('VRの機能を読み込んでいます…');
    expect(fb.step).toBe('loading');
  });
  it('follows prepare -> starting -> running with the matching texts (AR names itself)', () => {
    const { ar, footer, fb } = setup();
    fb.set('loading', { button: ar, mode: 'ar' });
    fb.set('prepare', { button: ar, mode: 'ar', text: 'データ読み込み 3 / 9' });
    expect(footer.textContent).toBe('ARの準備中: データ読み込み 3 / 9'); expect(ar.textContent).toBe('準備中…');
    fb.set('starting', { button: ar, mode: 'ar' });
    expect(footer.textContent).toBe('ARを起動しています'); expect(ar.textContent).toBe('起動中…');
    fb.set('running', { button: ar, mode: 'ar' });
    expect(footer.textContent).toBe('AR表示中'); expect(ar.textContent).toBe('表示中');
  });
  it('clear (success end, failure, closed panel) restores labels, i18n attribute, buttons and the footer', () => {
    const { vr, ar, footer, fb } = setup();
    fb.set('loading', { button: vr, mode: 'vr' });
    expect(vr.has('data-i18n')).toBe(false); // a language switch must not overwrite the busy label
    fb.set('running', { button: vr, mode: 'vr' });
    fb.clear();
    expect(vr.disabled).toBe(false); expect(ar.disabled).toBe(false);
    expect(vr.textContent).toBe('VRで見る'); expect(vr.getAttribute('data-i18n')).toBe('vrView');
    expect(vr.getAttribute('aria-busy')).toBe(null);
    expect(footer.textContent).toBe('ready'); expect(fb.step).toBe('');
  });
  it('keeps a message written by something else (the failure text) when cleared', () => {
    const { vr, footer, fb } = setup();
    fb.set('starting', { button: vr, mode: 'vr' });
    footer.textContent = 'VRを開始できませんでした: x';
    fb.clear();
    expect(footer.textContent).toBe('VRを開始できませんでした: x');
  });
  it('clear without a busy state is a no-op', () => {
    const { footer, fb } = setup();
    footer.textContent = 'other'; fb.clear();
    expect(footer.textContent).toBe('other');
  });
});

describe('xr feedback wiring', () => {
  const app = readFileSync('docs/app.js', 'utf8'), vr = readFileSync('docs/vr-view.js', 'utf8'), i18n = readFileSync('docs/i18n.js', 'utf8');
  it('has ja and en strings for every key', () => {
    for (const k of ['vrBtnBusy', 'vrBtnStarting', 'vrBtnRunning', 'vrStepLoading', 'vrStepPrepare', 'vrStepStarting', 'vrStepRunning'])
      expect(i18n.split(k + ':').length - 1, k).toBe(2);
  });
  it('the press sets the busy state before any await and the session request is not delayed by it', () => {
    const body = app.slice(app.indexOf('const xrStart=mode'), app.indexOf("vrViewBtn.onclick=xrStart('vr')"));
    expect(body.indexOf("xrFb.set('loading'")).toBeGreaterThan(-1);
    expect(body.indexOf("xrFb.set('loading'")).toBeLessThan(body.indexOf('await'));
    // startVrView: the busy/step callback is synchronous right before requestSession, nothing awaited in between
    const sv = vr.slice(vr.indexOf("step('session');"), vr.indexOf('session=await navigator.xr.requestSession'));
    expect(sv).not.toMatch(/await/);
  });
  it('in-session statuses are shown before the long synchronous steps', () => {
    expect(vr).toMatch(/ui\.status=L\.uploading;menu\.refresh\(\);await nextFrames/);
    expect(vr).toMatch(/ui\.status=L\.compiling;menu\.refresh\(\);await nextFrames/);
    expect(vr.indexOf('ui.status=L.compiling')).toBeLessThan(vr.indexOf('install(P,{full:')); // the session's material is made by install, after this status
  });
});
