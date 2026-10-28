import { tr } from './i18n.js?v=20261027-build680';

export const ARM_MS = 4000, NOTE_MS = 3500;
const workspace = () => document.documentElement.classList.contains('vrl-ipad-ui');

export function askInline(text, { host = null, okKey = 'askApply', cancelKey = 'askCancel', tab = 'data' } = {}) {
  const target = host || document.querySelector('[data-ipad-drawer-section="data"]');
  if (!workspace() || !target) return Promise.resolve(globalThis.confirm ? globalThis.confirm(text) : false);
  if (!host && tab) document.dispatchEvent(new CustomEvent('vrl-ipad-settings-tab', { detail: { tab } }));
  return new Promise(resolve => {
    const box = document.createElement('div'); box.className = 'ws-ask'; box.setAttribute('role', 'group');
    const msg = document.createElement('p'); msg.className = 'ws-ask-text'; msg.textContent = text; msg.setAttribute('aria-live', 'polite');
    const row = document.createElement('div'); row.className = 'ws-ask-actions';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'primary-button'; ok.textContent = tr(okKey);
    const no = document.createElement('button'); no.type = 'button'; no.className = 'secondary-button'; no.textContent = tr(cancelKey);
    row.append(no, ok); box.append(msg, row); target.prepend(box);
    const done = v => { removeEventListener('keydown', esc, true); box.classList.add('is-leaving'); setTimeout(() => box.remove(), 180); resolve(v); };
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    ok.onclick = () => done(true); no.onclick = () => done(false);
    addEventListener('keydown', esc, true);
    box.scrollIntoView?.({ block: 'nearest' }); ok.focus({ preventScroll: true });
  });
}

export function armConfirm(btn, run, { armedKey = 'askPressAgain' } = {}) {
  if (!btn) return;
  let timer = 0, label = '';
  const disarm = () => { clearTimeout(timer); timer = 0; if (btn.classList.contains('is-armed')) { btn.classList.remove('is-armed'); btn.textContent = label; } };
  btn.onclick = async () => {
    if (!btn.classList.contains('is-armed')) {
      label = btn.textContent; btn.classList.add('is-armed'); btn.textContent = tr(armedKey);
      timer = setTimeout(disarm, ARM_MS); return;
    }
    disarm(); await run();
  };
  btn.addEventListener('blur', () => setTimeout(disarm, 150));
}

export function noteInline(el, text) {
  if (!el) return;
  let n = el.nextElementSibling;
  if (!n || !n.classList.contains('ws-note')) { n = document.createElement('span'); n.className = 'ws-note'; n.setAttribute('role', 'status'); el.after(n); }
  n.textContent = text; n.classList.remove('is-leaving');
  clearTimeout(n._t); n._t = setTimeout(() => { n.classList.add('is-leaving'); setTimeout(() => n.remove(), 250); }, NOTE_MS);
}
