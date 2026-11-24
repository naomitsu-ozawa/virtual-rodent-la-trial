// The record of the WebGPU view's "direct draw" trial (vr-wgpu-direct.js): how many frames drew the centre of the volume straight into the headset's eye image, what the check found, and why the path was off.
// Pure (no DOM, no GPU, no three.js). vr-view.js feeds it (frame / check / note / takeRow) and the performance report prints it (directReport, called from perfReport in vr-perf-log.js).
// Nothing here changes what is drawn.
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function createDirectLog() {
  const tot = { frames: 0, used: 0, asked: 0, miss: 0 }; // frames the loop drew / drew with the direct path / asked for it (switch on, f = 1) / asked but the path could not be recorded (miss)
  const sec = { used: 0, miss: 0 };
  const chk = { n: 0, px: 0, covered: 0, colour: 0, depth: 0, bad: 0, frames: 0, lines: [] }; // the check: checks made, pixels compared, pixels covered by the volume, pixels whose colour / depth differ, checks with a difference
  const notes = {}; // free text lines (the state of the path: installed, pipeline compiled, why it is off)
  let state = null;
  // one drawn frame: asked = the switch was on and the loop asked for the path; used = the frame's centre went through it; miss = asked, but the volume renderer used the offscreen path (not ready / not allowed)
  const frame = (asked, used) => {
    tot.frames++;
    if (asked) { tot.asked++; if (used) { tot.used++; sec.used++; } else { tot.miss++; sec.miss++; } }
  };
  // the result of one check (vr-wgpu-direct.js check): total = pixels of the compared rect, covered = pixels with colour alpha > 0 in either image, colour / depth = pixels that differ
  const check = r => {
    if (!r || !(r.total > 0)) return;
    chk.n++; chk.px += r.total; chk.covered += r.covered | 0; chk.colour += r.colour | 0; chk.depth += r.depth | 0;
    if ((r.colour | 0) > 0 || (r.depth | 0) > 0) { chk.bad++; if (chk.lines.length < 20) chk.lines.push(r.text || ('colour ' + (r.colour | 0) + ' depth ' + (r.depth | 0) + ' of ' + r.total)); }
  };
  const note = (k, text) => { if (text === null || text === undefined) delete notes[k]; else notes[k] = String(text); };
  const setState = s => { state = s; };
  // the second's numbers for the performance record's row (the keys are columns of the report below): dir = frames drawn with the direct path, dmiss = asked but not used
  const takeRow = () => { const x = { dir: sec.used, dmiss: sec.miss }; sec.used = 0; sec.miss = 0; return x; };
  return { frame, check, note, setState, takeRow, totals: tot, checks: chk, notes, get state() { return state; } };
}

// the lines of the report (perfReport): nothing when the session never asked for the path and nothing was noted
export function directReport(p) {
  const d = p?.direct;
  if (!d) return [];
  const t = d.totals, c = d.checks, L = [];
  if (!t.asked && !c.n && !Object.keys(d.notes).length) return [];
  L.push('-- direct draw (trial): the centre of the volume (the part of the centre rect that has full weight in the composite) is drawn by the volume\'s own pipeline straight into the headset\'s eye image, inside three.js\' eye pass, at the composite\'s place in the draw order; the band, the periphery pass and the other objects are as before');
  for (const [k, v] of Object.entries(d.notes)) L.push(k + ': ' + v);
  if (d.state) L.push('state: ' + d.state);
  L.push('frames: ' + t.frames + ' drawn, ' + t.asked + ' asked for the direct path (switch on and scale 1), ' + t.used + ' went through it, ' + t.miss + ' asked but drawn by the offscreen path (not ready / not allowed / not recorded)');
  L.push('check (only while the breakdown records; eye 0, the same camera, the reference = the current centre pass drawn again over the same rect, against the direct material drawn into a scratch image; whatever the switch is): ' + c.n + ' checks, ' + c.px + ' px compared (' + c.covered + ' px covered by the volume), colour differs in ' + c.colour + ' px, depth differs in ' + c.depth + ' px, ' + c.bad + ' checks with a difference');
  for (const l of c.lines) L.push('  check with a difference: ' + l);
  L.push('note: the check compares the volume\'s colour (quantised to 8 bit as the composite sees it) and the packed 24-bit depth, pixel for pixel; the blend into the eye image, the depth test and the frag_depth write of the real path are not part of it (not checked).');
  L.push('note: with the direct path on, vol = the pre-pass and the band of the centre pass only (the centre march is inside three.js\' eye pass: it is in main); compare span (the frame\'s GPU timeline) and the frame intervals between a recording with the switch off and one with it on. The breakdown\'s shadow passes are not taken in a direct frame.');
  const rows = (p.rows || []).filter(r => r.dir !== null && r.dir !== undefined);
  // the seconds with a direct frame against the seconds without one (rows with the menu closed only; the median of each column over the rows that have a value): where the volume's GPU time went (vol falls, main rises) and what the frame's GPU timeline did (span)
  const med = (rs, k) => { const v = rs.map(r => r[k]).filter(x => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length & 1 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const closed = rows.filter(r => !r.menu && r.fps > 0), on = closed.filter(r => r.dir > 0), off = closed.filter(r => r.dir === 0);
  if (on.length || off.length) {
    const f = v => (v === null ? '-' : String(r1(v)));
    L.push('rows with the menu closed: with direct frames (dir > 0): ' + on.length + ' rows, vol ' + f(med(on, 'vol')) + ' ms, main ' + f(med(on, 'main')) + ' ms, span ' + f(med(on, 'span')) + ' ms, frame intervals over 1.5 periods (g2 + g3) ' + on.reduce((a, r) => a + (r.g2 | 0) + (r.g3 | 0), 0) + ' of ' + on.reduce((a, r) => a + (r.g1 | 0) + (r.g2 | 0) + (r.g3 | 0), 0)
      + ' · without (dir = 0): ' + off.length + ' rows, vol ' + f(med(off, 'vol')) + ' ms, main ' + f(med(off, 'main')) + ' ms, span ' + f(med(off, 'span')) + ' ms, over 1.5 periods ' + off.reduce((a, r) => a + (r.g2 | 0) + (r.g3 | 0), 0) + ' of ' + off.reduce((a, r) => a + (r.g1 | 0) + (r.g2 | 0) + (r.g3 | 0), 0));
  }
  if (rows.length) {
    L.push('-- direct draw rows (t s; dir = frames drawn with the direct path in that second; dmiss = asked but not used; f = scale; vol / main / span = GPU ms as in the rows above)');
    L.push(['t', 'dir', 'dmiss', 'f', 'vol', 'main', 'span', 'oth'].map((k, i) => k.padStart(i === 0 ? 4 : 6)).join(' '));
    const cell = (v, w) => String(v === null || v === undefined ? '-' : v).padStart(w);
    for (const r of rows) L.push([cell(r.t, 4), cell(r.dir, 6), cell(r.dmiss, 6), cell(r.f, 6), cell(r1(r.vol), 6), cell(r1(r.main), 6), cell(r1(r.span), 6), cell(r1(r.oth), 6)].join(' '));
  }
  return L;
}
