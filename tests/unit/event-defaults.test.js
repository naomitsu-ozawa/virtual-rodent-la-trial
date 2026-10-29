import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const grab = re => { const m = re.exec(src); if (!m) throw new Error('not found: ' + re); return m[0]; };
const versionLine = grab(/const DEFAULTS_VERSION=4,DEFAULTS_VERSION_KEYS=\[[^\]]*\],DEFAULTS_VERSION_STEPS=[^\n]*\]\];/);
const defaultsLine = grab(/const DEFAULTS=\{cap:1,[^\n]*\};/);
const loadFn = grab(/function loadSettings\(\)\{[^\n]*\}/), saveFn = grab(/function saveSettings\(v\)\{[^\n]*\}/);
const migrateFn = grab(/function migrateStartValues\(v\)\{[^\n]*\}/);
const make = () => new Function('DEFAULT_WHEEL', 'LABEL_HIDE_DEFAULT', `${versionLine}\n${defaultsLine}\n${migrateFn}\nreturn {DEFAULTS,DEFAULTS_VERSION,DEFAULTS_VERSION_KEYS,migrateStartValues};`)([1, 2, 3], 1);

describe('VR view settings: start values', () => {
  const { DEFAULTS } = make();
  it('transparent CT value -600, slice opacity 60 %, slice tint 45 %', () => {
    expect(DEFAULTS.sliceAir).toBe(-600);
    expect(DEFAULTS.sliceOpacity).toBe(0.6);
    expect(DEFAULTS.sliceTint).toBe(0.45);
  });
  it('操作方法 and メニュー: fixed (help 2, menuMode 1); 断面切り取り: one side (cut 2)', () => {
    expect(DEFAULTS.help).toBe(2);
    expect(DEFAULTS.menuMode).toBe(1);
    expect(DEFAULTS.cut).toBe(2);
  });
  it('the slider steps keep the start values reachable (opacity / tint in 5 %, the air floor in 10 HU)', () => {
    expect(Math.round(DEFAULTS.sliceOpacity * 20) / 20).toBe(DEFAULTS.sliceOpacity);
    expect(Math.round(DEFAULTS.sliceTint * 20) / 20).toBe(DEFAULTS.sliceTint);
    expect(Math.abs(DEFAULTS.sliceAir % 10)).toBe(0);
  });
  it('the 体験会 reset (resetEventViewSettings) takes the same start values: it copies DEFAULTS, menu / help included', () => {
    expect(src).toContain("const EVENT_VIEW_KEYS=['cut','cap','sliceAir','sliceTint','sliceOpacity','labelSize'];");
    expect(src).toContain('v.menuMode=DEFAULTS.menuMode;v.help=DEFAULTS.help;');
  });
  it('no other place falls back to the earlier air floor', () => {
    expect(src).not.toMatch(/sliceAir\)\?\+settings\.sliceAir:-500/);
  });
});

const OLD = { cap: 0, sliceAir: -500, sliceTint: 0.5, menuMode: 0, cut: 1, sliceOpacity: 0.7, help: 1, quality: 3, data: 2, foveation: 0, vres: 2, labelSize: 2 };
describe('VR view settings: a device with the earlier start values gets the new ones once', () => {
  it('old stored values (no dv) become the new start values; quality, data size and the quick ring stay', () => {
    const { migrateStartValues, DEFAULTS } = make();
    const v = { cap: 0, sliceAir: -500, sliceTint: 0.5, menuMode: 0, cut: 1, sliceOpacity: 0.7, help: 1, quality: 3, data: 2, foveation: 0, vres: 2, wheel: ['x'], labelSize: 2 };
    expect(migrateStartValues(v)).toBe(true);
    expect(v).toMatchObject({ sliceAir: -600, sliceTint: 0.45, menuMode: 1, cut: 2, sliceOpacity: 0.6, help: 2, ctShadeBright: 1.8, ctShadeContrast: 1.7, dv: 4 });
    expect(v).toMatchObject({ cap: 0, quality: 3, data: 2, foveation: 0, vres: 2, wheel: ['x'], labelSize: 2 });
  });
  it('once only: after it, the visitor / venue choices are kept', () => {
    const { migrateStartValues, DEFAULTS } = make();
    const v = { ...DEFAULTS, dv: 4, sliceOpacity: 0.3, help: 0, cut: 0, ctShadeBright: 1.2, ctShadeContrast: 0.9 };
    expect(migrateStartValues(v)).toBe(false);
    expect(v).toMatchObject({ sliceOpacity: 0.3, help: 0, cut: 0, ctShadeBright: 1.2, ctShadeContrast: 0.9 });
  });
  it('a device stored at dv 2 gets 濃淡の明るさ 180 % / 濃淡のコントラスト 170 % once; its other choices (air floor, opacity, help, cut, ...) stay', () => {
    const { migrateStartValues } = make();
    const v = { ...OLD, dv: 2, sliceAir: -250, sliceOpacity: 0.3, help: 0, cut: 1, ctShadeBright: 1.3, ctShadeContrast: 1 };
    expect(migrateStartValues(v)).toBe(true);
    expect(v).toMatchObject({ ctShadeBright: 1.8, ctShadeContrast: 1.7, dv: 4, sliceAir: -250, sliceOpacity: 0.3, help: 0, cut: 1, menuMode: 0, sliceTint: 0.5, quality: 3 });
    expect(migrateStartValues(v)).toBe(false);
  });
  it('the start values: 濃淡の明るさ 180 %, 濃淡のコントラスト 170 %', () => {
    const { DEFAULTS } = make();
    expect(DEFAULTS.ctShadeBright).toBe(1.8); expect(DEFAULTS.ctShadeContrast).toBe(1.7);
  });
  it('a saved laserStyle 1 becomes 2 (帯・太) once; a later choice of 1 stays; other keys stay', () => {
    const { migrateStartValues, DEFAULTS } = make();
    const v = { ...DEFAULTS, dv: 3, laserStyle: 1, sliceOpacity: 0.3, help: 0 };
    expect(migrateStartValues(v)).toBe(true);
    expect(v).toMatchObject({ laserStyle: 2, dv: 4, sliceOpacity: 0.3, help: 0 });
    v.laserStyle = 1; // the visitor picks 帯・細 in the menu
    expect(migrateStartValues(v)).toBe(false); expect(v.laserStyle).toBe(1);
  });
  it('through the real loadSettings, a stored laserStyle 1 is reset once and saved; the choice made afterwards survives later loads', () => {
    const store = {};
    const run = () => new Function('localStorage', 'DEFAULT_WHEEL', 'LABEL_HIDE_DEFAULT', 'normalizeWheelItems', 'migrateWheelSectionFlip', `const SETTINGS_KEY='vrl-vr-settings-5',OLD_KEYS=['vrl-vr-settings-4','vrl-vr-settings-3'];\n${versionLine}\n${defaultsLine}\n${migrateFn}\n${saveFn}\n${loadFn}\nreturn loadSettings();`)(
      { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, [1, 2, 3], 1, w => w, v => ({ wheel: v.wheel, wheelMig: v.wheelMig || 0, changed: false }));
    store['vrl-vr-settings-5'] = JSON.stringify({ ...OLD, dv: 3, laserStyle: 1 });
    expect(run().laserStyle).toBe(2); expect(JSON.parse(store['vrl-vr-settings-5'])).toMatchObject({ laserStyle: 2, dv: 4 });
    store['vrl-vr-settings-5'] = JSON.stringify({ ...JSON.parse(store['vrl-vr-settings-5']), laserStyle: 1 }); // chosen in the menu afterwards
    expect(run().laserStyle).toBe(1); expect(run().laserStyle).toBe(1);
  });
  it('DEFAULTS carries no dv (it would mask the stored one)', () => expect(defaultsLine).not.toMatch(/\bdv:/));
  it('the real loadSettings: an old stored object (no dv) is migrated and saved; the venue keys stay; a second load changes nothing; the user\'s later choice is kept', () => {
    const store = {};
    const run = () => new Function('localStorage', 'DEFAULT_WHEEL', 'LABEL_HIDE_DEFAULT', 'normalizeWheelItems', 'migrateWheelSectionFlip', `const SETTINGS_KEY='vrl-vr-settings-5',OLD_KEYS=['vrl-vr-settings-4','vrl-vr-settings-3'];\n${versionLine}\n${defaultsLine}\n${migrateFn}\n${saveFn}\n${loadFn}\nreturn loadSettings();`)(
      { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, [1, 2, 3], 1, w => w, v => ({ wheel: v.wheel, wheelMig: v.wheelMig || 0, changed: false }));
    store['vrl-vr-settings-5'] = JSON.stringify(OLD);
    const v = run();
    expect(v).toMatchObject({ sliceAir: -600, sliceTint: 0.45, menuMode: 1, cut: 2, sliceOpacity: 0.6, help: 2, dv: 4, quality: 3, data: 2, foveation: 0, vres: 2, labelSize: 2 });
    expect(JSON.parse(store['vrl-vr-settings-5'])).toMatchObject({ sliceAir: -600, sliceOpacity: 0.6, dv: 4, quality: 3 }); // saved
    const saved = store['vrl-vr-settings-5'];
    expect(run()).toMatchObject({ sliceAir: -600, dv: 4 }); expect(store['vrl-vr-settings-5']).toBe(saved);
    store['vrl-vr-settings-5'] = JSON.stringify({ ...JSON.parse(saved), sliceOpacity: 0.3, cut: 1 });
    expect(run()).toMatchObject({ sliceOpacity: 0.3, cut: 1, sliceAir: -600 });
  });
  it('a brand new device (nothing stored) reads the start values (and writes dv once)', () => {
    const store = {};
    const v = new Function('localStorage', 'DEFAULT_WHEEL', 'LABEL_HIDE_DEFAULT', 'normalizeWheelItems', 'migrateWheelSectionFlip', `const SETTINGS_KEY='vrl-vr-settings-5',OLD_KEYS=['vrl-vr-settings-4','vrl-vr-settings-3'];\n${versionLine}\n${defaultsLine}\n${migrateFn}\n${saveFn}\n${loadFn}\nreturn loadSettings();`)(
      { getItem: k => store[k] ?? null, setItem: (k, x) => { store[k] = x; } }, [1], 1, w => w, v2 => ({ wheel: v2.wheel, wheelMig: 0, changed: false }));
    expect(v).toMatchObject({ sliceAir: -600, sliceOpacity: 0.6, sliceTint: 0.45, help: 2, menuMode: 1, cut: 2, dv: 4 });
  });
});

// The slice's one-press transparent toggle: the thumbstick click (xr-standard button 3) of either controller. vr-view.js is not runnable here: wiring is checked on its source.
describe('slice transparent toggle on the thumbstick click', () => {
  it('button 3, short press on release, on either hand, in the controller loop next to A/X and B/Y', () => {
    expect(src).toContain("{const tc=!!bt?.[3]?.pressed,ev=(c.userData.tcPress||=createButtonPress({longMs:FRAME_HIDE_MS})).update(tc,nowF);");
    expect(src).toContain("if(ev==='short')toggleSliceClear(c);");
    expect(src).toContain('const bt=c.userData.source?.gamepad?.buttons;'); // one read per controller (hands have no gamepad: no binding)
  });
  it('the toggle flips ui.sliceClear, pulses, shows the tag; the slider value (settings.sliceOpacity) is never written by it', () => {
    const fn = grab(/const toggleSliceClear=c=>\{[^\n]*\};/);
    expect(fn).toContain('ui.sliceClear=!ui.sliceClear;pulse(c,0.4,40);');
    expect(fn).toContain('sliceToast.set(L.sliceT+(ui.sliceClear?L.sliceClear:Math.round(settings.sliceOpacity*100)+\'%\'))');
    expect(fn).not.toMatch(/settings\.sliceOpacity\s*=/);
  });
  it('the volume is drawn at 0 while on, at the setting otherwise; the slider (simple and full menu) and the resets turn it off', () => {
    expect(src).toContain('u.sliceOpacity.value=section.on&&!bench.noSection&&!ui.sliceClear&&sliceReady()?settings.sliceOpacity:0;');
    expect(src.match(/set:v=>\{ui\.sliceClear=false;settings\.sliceOpacity=/g)?.length).toBe(2);
    expect(src).toContain('ui.sliceClear=false;sliceToast.until=0;sliceToast.mesh.visible=false;resetEventViewSettings(settings);');
    expect(src).toContain('const ui={sliceClear:false,'); // a new session starts with it off
  });
  it('no menu button for it (the simple menu has the slider only); the tag hides itself, is hidden in screenshots and disposed', () => {
    expect(src).not.toMatch(/acts=\{[^\n]*sliceClear/);
    expect(src).toContain('if(sliceToast.until&&performance.now()>sliceToast.until){sliceToast.until=0;sliceToast.mesh.visible=false}');
    expect(src).toContain('hidden=[menu.mesh,badge,sliceToast.mesh,');
    expect(src).toContain('sliceToast.dispose();');
  });
  it('the 操作方法 board lists it (basic and with a section; ja and en), 7 lines fit the board at the new pitch', () => {
    expect(src.match(/'スティック押し：短く＝スライス透明\/\/長押し＝枠を隠す／戻す'/g)?.length ?? src.split("'スティック押し：短く＝スライス透明／長押し＝枠を隠す／戻す'").length - 1).toBe(2);
    expect(src.split("'Stick click: short = slice clear, hold = hide / show frames'").length - 1).toBe(2);
    expect(src).toContain('const HELP_LINE_PITCH=66;');
    expect(140 + 6 * 66 + 15).toBeLessThanOrEqual(560); // the last line's centre + half the 30 px text, inside the 560 px board (no mission)
  });
  it('the thumbstick click stays free of other uses in VR: only the AR view switch (double press) reads button 3', () => {
    expect(src.match(/bt\?\.\[3\]/g).length).toBe(1);
    expect(src).toContain('bt?.[VIEW_TOGGLE_BUTTON]?.pressed'); // button 3 as a constant: the AR switch
  });
});

// short press = the slice toggle, hold = the section frames are TOGGLED (hold once: hidden and they stay hidden; hold again: shown). createButtonPress is the A/X press classifier (vr-ring.js).
const press = await import('../../docs/vr-ring.js');
describe('thumbstick click: short press vs hold (FRAME_HIDE_MS)', () => {
  const MS = +/const FRAME_HIDE_MS=(\d+)/.exec(src)[1];
  // runs a series of presses (ms held, then released) through the same classifier and the same toggle rule as the controller loop; hide: the state per frame
  const run = (downs, step = 11) => {
    const bp = press.createButtonPress({ longMs: MS }), events = [], hide = []; let hideFrames = false, t = 1000;
    const frame = pressed => { const ev = bp.update(pressed, t); if (ev === 'short') events.push('slice-toggle'); else if (ev === 'long') { hideFrames = !hideFrames; events.push(hideFrames ? 'hide-on' : 'hide-off'); } hide.push(hideFrames); t += step; };
    for (const d of downs) { for (let ms = 0; ms < d; ms += step) frame(true); frame(false); frame(false); }
    return { events, hide };
  };
  it('the hold time is 0.3 s', () => expect(MS).toBe(300));
  it('a short press (well under 0.3 s) toggles the slice once, on release; the frames never hide', () => {
    const r = run([120]);
    expect(r.events).toEqual(['slice-toggle']); expect(r.hide.some(Boolean)).toBe(false);
  });
  it('a hold hides the frames once it reaches 0.3 s, they STAY hidden after the release, and it fires NO slice toggle', () => {
    const r = run([900]);
    expect(r.events).toEqual(['hide-on']);
    expect(r.hide.indexOf(true)).toBeGreaterThan(0); expect(r.hide.at(-1)).toBe(true);
  });
  it('a second hold shows them again (on, off, on ...); a short press in between only toggles the slice and keeps the frames hidden', () => {
    expect(run([900, 900]).events).toEqual(['hide-on', 'hide-off']);
    expect(run([900, 120, 900, 900]).events).toEqual(['hide-on', 'slice-toggle', 'hide-off', 'hide-on']);
    expect(run([900, 120]).hide.at(-1)).toBe(true);
  });
  it('the boundary: just under 0.3 s toggles the slice, from 0.3 s on it is a hold', () => {
    expect(run([250]).events).toEqual(['slice-toggle']);
    expect(run([330]).events).toEqual(['hide-on']);
  });
  it('wiring: the hold calls toggleFramesHidden (no hold-to-hide, no release rule); the toggle clears every controller when any is hidden, else hides this one with the tutorial signal', () => {
    expect(src).toContain("else if(ev==='long')toggleFramesHidden(c);");
    expect(src).not.toContain('if(!tc&&c.userData.hideFrames){c.userData.hideFrames=false;pulse(c,0.2,25)}');
    const fn = grab(/const toggleFramesHidden=c=>\{[^\n]*\};/);
    expect(fn).toContain("if(framesHidden()){for(const x of controllers)x.userData.hideFrames=false;pulse(c,0.2,25);emit('frame-show')}");
    expect(fn).toContain("else{c.userData.hideFrames=true;pulse(c,0.3,25);emit('frame-hide')}}");
  });
  it("behaviour: 'frame-hide' is emitted only when hiding, 'frame-show' only when showing; the state alternates", () => {
    const fn = grab(/const toggleFramesHidden=c=>\{[^\n]*\};/).replace(/\/\/.*$/, '');
    const controllers = [{ userData: {} }, { userData: {} }], emitted = [];
    const framesHidden = () => controllers.some(x => x.userData.hideFrames);
    const make = new Function('controllers', 'framesHidden', 'pulse', 'emit', fn + '; return toggleFramesHidden;');
    const toggle = make(controllers, framesHidden, () => {}, k => emitted.push(k));
    toggle(controllers[0]); expect(framesHidden()).toBe(true); expect(emitted).toEqual(['frame-hide']);
    toggle(controllers[1]); expect(framesHidden()).toBe(false); expect(emitted).toEqual(['frame-hide', 'frame-show']);
    controllers[1].userData.hideFrames = true; toggle(controllers[0]); expect(framesHidden()).toBe(false); expect(emitted).toEqual(['frame-hide', 'frame-show', 'frame-show']); // hidden by the other controller: this hold shows them
  });
  it('frames hidden: outline, tag, hover fill, glow and arrow are not drawn; no tag / band / glass for the laser; no empty-space drag; no section is dragged by a press; the clipping is untouched', () => {
    expect(src).toContain('pl.glow.visible=gc!==undefined&&!fHide;pl.glass.visible=glassBy.has(pl)&&!fHide;pl.frameLine.visible=!fHide;pl.handle.visible=!fHide;');
    expect(src).toContain('pl.arrow.visible=arrowShown(settings.cut,pl.cut,pl.aOp)&&!fHide;');
    expect(src).toContain('const vis=section.on&&!fHide?planes.filter(p=>!draggedBy(p,c)):[];');
    expect(src).toContain('canDrag:anyOk&&!fHide&&(surfaceActive()||labelMode()||!vh)');
    expect(src).toContain('if(section.on&&vrHalfExt&&!framesHidden()){');
    expect(src).toContain('const framesHidden=()=>controllers.some(x=>x.userData.hideFrames&&(!!x.userData.source?.gamepad||isHand(x.userData.source)))'.replace('const ', '')); // a disconnected controller / hand never leaves the frames hidden
    expect(src).not.toMatch(/fHide[^;\n]*(cutPlanes|planeCount|planeCut)/); // the cut uniforms do not look at it
  });
});
