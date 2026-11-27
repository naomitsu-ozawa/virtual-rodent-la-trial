// Part-cut diagnostic log of the VR view (pure module: no DOM, no WebGL, no clock of its own).
//
// What it is for: finding out, on the headset, how heavy it is to cut a part out of the body (partDetach .. the part's own bake)
// and to keep it out. vr-view.js adds ONE line a second (the once-a-second block of the frame loop) and an event line at each
// step of the cut and of the bakes; the text is kept in two ring buffers (the newest 600 rows; the events: the first 300 are pinned and the newest fill the rest of 5000) and is only
// turned into a file by the page's 保存 / Save button after the session. Nothing here reads anything back from the GPU.
//
// The text: a header (# lines), then rows (S ...) and events (E ...) merged by time:
//   S 12.0s fps=72 vol=3.1 main=2.0 js=1.2 eff=0.85 per=0.60 data=256 step=2 gpuTimer=1 menu=0 parts=2 [u1:N/done u2:P/making] bodyBound=1 bodyReady=1 partBytes=123456
//   E   12345ms pbStart u1 bytes=... box=...
// part descriptor  u<id>:<draw>/<bake>   draw  N = the ordinary program (baked bytes bound and current), P = the VRL_PART programs
//                                        bake  idle (not started) / making / done / skip (given up for this field)

export const PART_LOG_MAX_ROWS = 600;
export const PART_LOG_MAX_EVENTS = 5000; // a session makes 500-600 events; ~142 bytes each (measured); the worst case is ~0.9 MB
export const PART_LOG_KEEP_EVENTS = 300; // the first events are pinned: past the cap only the middle is dropped, the opening (nCompile, prep, the first bake) stays
export const PART_LOG_KEY = 'vrl-vr-part-log';
const DETAIL_MAX = 200;

// a ring buffer: push is O(1), toArray is oldest first; `total` counts every push (what was dropped = total - length).
// keepHead: the first `keepHead` pushes are pinned and never dropped (the session's opening steps: prep, nCompile, the first bake);
// once the buffer is full only the entries after the pinned ones are dropped, oldest first. keepHead is clamped below max.
export function createRing(max, keepHead = 0) {
  const cap = Math.max(1, max | 0), hd = Math.min(Math.max(0, keepHead | 0), cap - 1), rc = cap - hd, buf = new Array(rc), pin = [];
  let head = 0, len = 0, total = 0;
  return {
    push(x) { total++; if (pin.length < hd) { pin.push(x); return; } buf[head] = x; head = (head + 1) % rc; if (len < rc) len++; },
    toArray() { const out = pin.slice(), s = (head - len + rc) % rc; for (let i = 0; i < len; i++) out.push(buf[(s + i) % rc]); return out; },
    get length() { return pin.length + len; },
    get total() { return total; },
    clear() { head = 0; len = 0; total = 0; pin.length = 0; buf.fill(undefined); },
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const clean = v => String(v).replace(/[\r\n]+/g, ' ');
const num = (v, d) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(d) : '-';
  return v == null || v === '' ? '-' : clean(v).replace('–', '-'); // the page's average strings use an en dash for "no sample"
};
const bit = v => (v ? 1 : 0);

// one part: {id, n: drawn by the ordinary program, s: 'idle' | 'making' | 'done' | 'skip'}
const partText = p => 'u' + clean(p?.id ?? '?') + ':' + (p?.n ? 'N' : 'P') + '/' + clean(p?.s || 'idle');

// row = {fps, vol, main, js (ms, numbers or the page's strings), eff, per, data, step, timer, menu, parts: [part], bodyBound, bodyReady, bytes}
export function formatRow(tMs, row) {
  const r = row || {}, ps = Array.isArray(r.parts) ? r.parts : [];
  return 'S ' + ((tMs || 0) / 1000).toFixed(1) + 's fps=' + num(r.fps, 0) + ' vol=' + num(r.vol, 1) + ' main=' + num(r.main, 1) + ' js=' + num(r.js, 1)
    + ' eff=' + num(r.eff, 2) + ' per=' + num(r.per, 2) + ' data=' + num(r.data, 0) + ' step=' + num(r.step, 0)
    + ' gpuTimer=' + bit(r.timer) + ' menu=' + bit(r.menu) + ' parts=' + ps.length + ' [' + ps.map(partText).join(' ') + ']'
    + ' bodyBound=' + bit(r.bodyBound) + ' bodyReady=' + bit(r.bodyReady) + ' partBytes=' + Math.max(0, Math.round(+r.bytes || 0));
}

export function formatEvent(tMs, name, detail) {
  const d = detail == null || detail === '' ? '' : ' ' + clean(detail).slice(0, DETAIL_MAX);
  return 'E ' + String(Math.max(0, Math.round(tMs || 0))).padStart(7) + 'ms ' + clean(name) + d;
}

// the file name: vrl-vr-part-log-<build>-<YYYYMMDD>-<HHMM>.txt (local time, as the screenshots' names)
export function partLogFileName(build, date) {
  const d = date instanceof Date ? date : new Date(date);
  const b = String(build ?? '').replace(/[^A-Za-z0-9._-]/g, '') || 'x';
  return 'vrl-vr-part-log-' + b + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.txt';
}

const localStamp = d => {
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    + ' ' + (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
};

// meta = {build, startedAt (epoch ms), ua, mode, dims, language, prep: {gpu, gpuKey, allCompiled, set, compiled: [variant keys]}}
export function formatHeader(meta, counts) {
  const m = meta || {}, c = counts || {};
  const lines = ['# VRL VR part log'];
  lines.push('# build: ' + clean(m.build ?? '?'));
  if (Number.isFinite(m.startedAt)) lines.push('# started: ' + localStamp(new Date(m.startedAt)));
  if (m.mode) lines.push('# mode: ' + clean(m.mode));
  lines.push('# userAgent: ' + clean(m.ua || '?'));
  lines.push('# data: ' + (m.dims ? clean(m.dims) : '?'));
  if (m.prep && typeof m.prep === 'object') { // what the session started with: the page's prepared renderer (gpu), every set compiled before it (allCompiled), the body set and its compiled variants
    const p = m.prep, ks = Array.isArray(p.compiled) ? p.compiled.map(clean) : [];
    lines.push('# prep: gpu=' + bit(p.gpu) + ' gpuKey=' + bit(p.gpuKey) + ' allCompiled=' + bit(p.allCompiled) + ' set=' + clean(p.set ?? '?') + ' compiled=' + ks.length + ' [' + ks.join(' ') + ']');
  }
  lines.push('# rows: ' + (c.rows | 0) + (c.rowsDropped ? ' (oldest ' + c.rowsDropped + ' dropped)' : '') + ' / events: ' + (c.events | 0) + (c.eventsDropped ? ' (' + c.eventsDropped + ' dropped after the first ' + PART_LOG_KEEP_EVENTS + ')' : ''));
  return lines.join('\n');
}

export function createPartLog({ maxRows = PART_LOG_MAX_ROWS, maxEvents = PART_LOG_MAX_EVENTS } = {}) {
  const rows = createRing(maxRows), events = createRing(maxEvents, PART_LOG_KEEP_EVENTS);
  let meta = {};
  return {
    setMeta(o) { try { meta = { ...meta, ...o }; } catch { /* the log never throws */ } },
    getMeta() { return meta; },
    // a row / an event: tMs = milliseconds since the session began. Both are a string appended to a ring (no work beyond that)
    row(tMs, row) { try { rows.push({ t: tMs, line: formatRow(tMs, row) }); } catch { /* ignore */ } },
    event(tMs, name, detail) { try { events.push({ t: tMs, line: formatEvent(tMs, name, detail) }); } catch { /* ignore */ } },
    hasRows() { return rows.length > 0; },
    stats() { return { rows: rows.length, events: events.length, rowsDropped: rows.total - rows.length, eventsDropped: events.total - events.length }; },
    // the whole text: header, then rows and events merged by time (an event before the row of the same instant)
    text() {
      const st = this.stats(), merged = [];
      for (const e of events.toArray()) merged.push({ t: e.t, k: 0, line: e.line });
      for (const r of rows.toArray()) merged.push({ t: r.t, k: 1, line: r.line });
      merged.sort((a, b) => a.t - b.t || a.k - b.k);
      return formatHeader(meta, st) + '\n' + merged.map(x => x.line).join('\n') + '\n';
    },
    clear() { rows.clear(); events.clear(); },
  };
}
