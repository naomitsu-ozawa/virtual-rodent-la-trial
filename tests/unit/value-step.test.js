import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { STEP_PRESS, STEP_FAST, HOLD_DELAY_MS, HOLD_INTERVAL_MS, HOLD_SLOW_MS, repeatCountAt, repeatStep, repeatTotal, stepClamp, createStepHold, wireStepButton } from '../../docs/value-step.js';

// ＋ / − of the sliders that hold DATA VALUES: a press = 10; holding repeats after 0.4 s, one step every 0.1 s, 10 per step for the first 1 s of repeating, then 100 per step; release stops; clamped.
const vr = readFileSync('docs/vr-view.js', 'utf8'), sectionShade = readFileSync('docs/section-shade.js', 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b, s.indexOf(a) + a.length));

describe('the step / acceleration rule (docs/value-step.js)', () => {
  it('the constants are the approved ones: press 10, repeat from 0.4 s every 0.1 s, 10 per step for the first 1 s then 100', () => {
    expect([STEP_PRESS, STEP_FAST, HOLD_DELAY_MS, HOLD_INTERVAL_MS, HOLD_SLOW_MS]).toEqual([10, 100, 400, 100, 1000]);
  });
  it('nothing repeats before 0.4 s; the first repeat is at 0.4 s, then one every 0.1 s', () => {
    expect(repeatCountAt(0)).toBe(0); expect(repeatCountAt(399)).toBe(0); expect(repeatCountAt(400)).toBe(1); expect(repeatCountAt(499)).toBe(1); expect(repeatCountAt(500)).toBe(2); expect(repeatCountAt(1400)).toBe(11); expect(repeatCountAt(2400)).toBe(21);
  });
  it('the first 1 s of repeating (10 repeats) is 10 per step, after that 100 per step', () => {
    for (let k = 0; k < 10; k++) expect(repeatStep(k)).toBe(10);
    for (let k = 10; k < 30; k++) expect(repeatStep(k)).toBe(100);
    expect(repeatTotal(0, 10)).toBe(100); expect(repeatTotal(0, 11)).toBe(200); expect(repeatTotal(5, 12)).toBe(5 * 10 + 2 * 100); expect(repeatTotal(3, 3)).toBe(0);
  });
  it('a held button: the press gives 10 at once, then the steps come due as time passes (checked at any pace: the total is the same)', () => {
    const h = createStepHold(); expect(h.active).toBe(false); expect(h.update(1000)).toBe(0);
    expect(h.press(1000)).toBe(10); expect(h.active).toBe(true);
    expect(h.update(1399)).toBe(0); expect(h.update(1400)).toBe(10); expect(h.update(1450)).toBe(0); expect(h.update(1500)).toBe(10);
    // 1 s of repeating at 10, then 100: repeats 0..9 at 1400..2300 (10 each), repeat 10 at 2400 (100)
    expect(h.update(2300)).toBe(10 * 8); expect(h.update(2399)).toBe(0); expect(h.update(2400)).toBe(100); expect(h.update(2700)).toBe(300);
    const a = createStepHold(), b = createStepHold(); a.press(0); b.press(0);
    let sum = 0; for (let t = 0; t < 3000; t += 7) sum += a.update(t); sum += a.update(3000); expect(sum).toBe(b.update(3000)); expect(sum).toBe(repeatTotal(0, 27)); // the pace of the checks does not change the total
    h.release(); expect(h.active).toBe(false); expect(h.update(9999)).toBe(0);
  });
  it('a late first check (a slow frame) pays all the repeats that were due, with their own sizes', () => {
    const h = createStepHold(); h.press(0);
    expect(h.update(2500)).toBe(repeatTotal(0, repeatCountAt(2500))); expect(repeatTotal(0, repeatCountAt(2500))).toBe(10 * 10 + 100 * 12); // 22 repeats are due at 2.5 s: 0..9 at 10, 10..21 at 100
  });
  it('the value is clamped to the slider limits (and a missing limit is no limit)', () => {
    expect(stepClamp(95, 10, 0, 100)).toBe(100); expect(stepClamp(5, -10, 0, 100)).toBe(0); expect(stepClamp(50, 100, 0, 100)).toBe(100); expect(stepClamp(50, -100, 0, 100)).toBe(0);
    expect(stepClamp(50, 10, -Infinity, Infinity)).toBe(60); expect(stepClamp(50, 10, undefined, undefined)).toBe(60); expect(stepClamp(-1020, -10, -1024, 3071)).toBe(-1024);
  });
});

// a minimal button and a manual clock / timer for wireStepButton
function fakeButton() {
  const l = {}; return { disabled: false, addEventListener: (t, f) => { (l[t] ||= new Set()).add(f); }, removeEventListener: (t, f) => l[t]?.delete(f), fire: (t, e = {}) => { for (const f of [...(l[t] || [])]) f({ button: 0, preventDefault() {}, ...e }); }, count: () => Object.values(l).reduce((n, s) => n + s.size, 0) };
}
describe('the browser button (wireStepButton)', () => {
  const make = () => {
    let t = 0, fn = null, timers = 0; const calls = [], btn = fakeButton();
    const off = wireStepButton(btn, -1, d => calls.push(d), { now: () => t, setTimer: f => { fn = f; timers++; return 1; }, clearTimer: () => { fn = null; } });
    return { btn, calls, off, at: ms => { t = ms; fn?.(); }, timers: () => timers, running: () => !!fn };
  };
  it('a short press changes the value by 10 once (signed by the button), and stops at release', () => {
    const x = make(); x.btn.fire('pointerdown'); expect(x.calls).toEqual([-10]); x.at(300); expect(x.calls).toEqual([-10]); x.btn.fire('pointerup'); expect(x.running()).toBe(false); x.at(2000); expect(x.calls).toEqual([-10]);
  });
  it('holding repeats: 10 per step for the first second of repeating, then 100; release stops', () => {
    const x = make(); x.btn.fire('pointerdown');
    for (let t = 100; t <= 2400; t += 100) x.at(t);
    expect(x.calls[0]).toBe(-10); expect(x.calls.slice(1, 11)).toEqual(Array(10).fill(-10)); expect(x.calls[11]).toBe(-100); expect(x.calls.length).toBe(1 + 10 + 11); // the press, 10 repeats of 10 (0.4 s .. 1.3 s), 11 of 100 (1.4 s .. 2.4 s)
    x.btn.fire('pointerleave'); const n = x.calls.length; x.at(5000); expect(x.calls.length).toBe(n);
  });
  it('leaving the button or cancelling stops it; a disabled button and a non-primary button do nothing; one pointerdown starts one timer', () => {
    const x = make(); x.btn.disabled = true; x.btn.fire('pointerdown'); expect(x.calls).toEqual([]);
    x.btn.disabled = false; x.btn.fire('pointerdown', { button: 2 }); expect(x.calls).toEqual([]);
    x.btn.fire('pointerdown'); expect(x.timers()).toBe(1); x.btn.fire('pointercancel'); expect(x.running()).toBe(false);
  });
  it('release stops also on window blur and when the button becomes disabled; touch-action none', () => {
    let t = 0, fn = null; const calls = [], btn = fakeButton(), wl = new Set(); btn.style = {};
    const win = { addEventListener: (e, f) => e === 'blur' && wl.add(f), removeEventListener: (e, f) => wl.delete(f) };
    const off = wireStepButton(btn, 1, d => calls.push(d), { now: () => t, setTimer: f => { fn = f; return 1; }, clearTimer: () => { fn = null; }, win });
    expect(btn.style.touchAction).toBe('none');
    btn.fire('pointerdown'); expect(fn).not.toBe(null); for (const f of wl) f(); expect(fn).toBe(null);
    btn.fire('pointerdown'); btn.disabled = true; t = 500; fn(); expect(fn).toBe(null); expect(calls).toEqual([10, 10]);
    off(); expect(wl.size).toBe(0);
  });
  it('a key press (Enter / Space) is one short step; the returned function removes every listener', () => {
    const x = make(); x.btn.fire('keydown', { key: 'Enter' }); x.btn.fire('keydown', { key: ' ' }); x.btn.fire('keydown', { key: 'a' }); expect(x.calls).toEqual([-10, -10]);
    x.off(); expect(x.btn.count()).toBe(0);
  });
});

describe('wiring: only the data-value sliders use it (VR and browser)', () => {
  it('VR: the window centre / width rows and the air level (CT values) have ＋ / − with the hold rule; brightness and contrast (percentages) do not', () => {
    const slice = between(vr, '}else if(ui.tab===2){', '}else if(ui.tab===3){');
    expect(slice).toContain("const apply=d=>{vrWindow[key]=Math.max(floor,stepClamp(vrWindow[key],d,lo,hi))};");
    expect(slice).toContain("btn(800,y,70,'−',false,()=>apply(-STEP_PRESS),{size:30,hold:d=>apply(-d)});btn(890,y,70,'＋',false,()=>apply(STEP_PRESS),{size:30,hold:apply})");
    expect(slice).toContain("btn(800,y0+520,70,'−',false,()=>nudge(-STEP_PRESS),{size:30,hold:d=>nudge(-d)});btn(890,y0+520,70,'＋',false,()=>nudge(STEP_PRESS),{size:30,hold:nudge});");
    expect(slice).toContain('const nudge=d=>put((Number.isFinite(+settings.sliceAir)?+settings.sliceAir:DEFAULTS.sliceAir)+d);');
    expect(slice).toContain("btn(800,y0+734,70,'−',false,()=>{settings.ctShadeBright=ctBrightOf(b-CT_BRIGHT_STEP);saveSettings(settings)},{size:30});");
    expect(slice).toContain("btn(800,y0+818,70,'−',false,()=>{settings.ctShadeContrast=ctContrastOf(c-CT_CONTRAST_STEP);saveSettings(settings)},{size:30});");
  });
  it('VR: the new range sliders have ＋ / − with the same rule, clamped to the data range and stopped by the other end', () => {
    const page = between(vr, '}else if(ui.tab===12){', '}else if(ui.tab===11){');
    expect(page).toContain("btn(800,y,70,'−',false,()=>apply(-STEP_PRESS),{size:30,hold:d=>apply(-d)});btn(890,y,70,'＋',false,()=>apply(STEP_PRESS),{size:30,hold:apply})");
    expect(page).toContain("stepClamp(which==='lower'?q.lower:q.upper,d,data.min,data.max)");
  });
  it('VR: a press on a button that has hold starts the hold; the frame loop repeats it while the laser stays on that button and the menu is open; the release ends it', () => {
    expect(vr).toContain("import { STEP_PRESS, stepClamp, createStepHold } from './value-step.js");
    expect(vr).toContain('else{menu.press(i);if(w.hold){const st=createStepHold();st.press(performance.now());c.userData.menuHold={i,st}}}');
    expect(vr).toContain('on=!!hm&&menu.hit(hm.uv)===mh.i}'); expect(vr).toContain('if(!on)c.userData.menuHold=null;else{const d=mh.st.update(performance.now()),w=d?menu.widget(mh.i):null;if(w?.hold){w.hold(d);menu.refresh()}}');
    expect(vr).toContain("c.addEventListener('selectend',()=>{c.userData.menuHold=null});");
    expect(vr).toContain('(hold to speed up)'); expect(vr).toContain('（押し続けると加速）');
  });
  it('browser: the new 下限 / 上限 sliders have ＋ / − (wireStepButton), clamped to the data range; the other panel sliders (明るさ, コントラスト, opacities) have none', () => {
    expect(sectionShade).toContain("import { wireStepButton, stepClamp } from './value-step.js");
    expect(sectionShade).toContain('wireStepButton(minus, -1, step()); if (plus) wireStepButton(plus, 1, step());');
    expect((sectionShade.match(/wireStepButton\(/g) || []).length).toBe(2); // − and ＋, in one loop that runs for lower and upper
    const shell = readFileSync('docs/ui-shell.js', 'utf8');
    expect(/id="section-shade-(bright|contrast)-(minus|plus)"/.test(shell)).toBe(false);
  });
});
