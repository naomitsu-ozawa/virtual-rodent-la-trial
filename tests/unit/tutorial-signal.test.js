import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { emit, SIGNAL_KINDS, poseMoved, scaleChanged } from '../../docs/tutorial-signal.js';

const DOCS = new URL('../../docs/', import.meta.url);
const files = readdirSync(DOCS).filter(f => f.endsWith('.js') && f !== 'tutorial-signal.js');
const src = Object.fromEntries(files.map(f => [f, readFileSync(new URL(f, DOCS), 'utf8')]));

describe('tutorial signals', () => {
  it('has the agreed kinds (trigger-label / label-show stay as signals even though no tutorial step waits for them;: no \'move\' (no walking task), + the deck\'s operations)', () => {
    expect(SIGNAL_KINDS.length).toBe(26);
    expect(new Set(SIGNAL_KINDS).size).toBe(26);
    expect(SIGNAL_KINDS).not.toContain('move');
    for (const k of ['grab', 'grab-move', 'seg-hide', 'seg-show', 'section-scroll', 'slice-opacity', 'slice-toggle']) expect(SIGNAL_KINDS).toContain(k);
  });
  it('every kind has an emit site in docs/', () => {
    for (const k of SIGNAL_KINDS) {
      const hit = Object.values(src).some(s => s.includes(`emit('${k}'`));
      expect(hit, k).toBe(true);
    }
  });
  it('emit is a no-op without document and never throws', () => {
    expect(typeof document).toBe('undefined');
    expect(() => emit('home')).not.toThrow();
    expect(() => emit('home', { a: 1 })).not.toThrow();
  });
  it('dispatches vrl-tut-signal when a document exists', () => {
    const got = [];
    globalThis.document = { dispatchEvent: e => got.push(e.detail) };
    try { emit('undo', { n: 2 }); emit('label-show'); emit('label-show'); } finally { delete globalThis.document; }
    expect(got[0]).toEqual({ kind: 'undo', n: 2 });
    expect(got.filter(g => g.kind === 'label-show').length).toBe(1); // rate-limited
  });
  it('no emit inside a shader string', () => {
    for (const [f, s] of Object.entries(src)) {
      for (const m of s.matchAll(/`([^`]*)`/g)) {
        if (!/gl_Position|gl_FragColor|precision\s+\w+\s+float|@compute|@fragment|@vertex/.test(m[1])) continue;
        expect(/\bemit\(\s*'/.test(m[1]), f).toBe(false);
      }
    }
  });
  it('rate limits: section-scroll and slice-opacity (they fire every frame / every drag step) at most once per 400 ms', () => {
    const got = [];
    globalThis.document = { dispatchEvent: e => got.push(e.detail.kind) };
    try { for (let i = 0; i < 5; i++) { emit('section-scroll'); emit('slice-opacity'); emit('grab'); } } finally { delete globalThis.document; }
    expect(got.filter(k => k === 'section-scroll')).toHaveLength(1);
    expect(got.filter(k => k === 'slice-opacity')).toHaveLength(1);
    expect(got.filter(k => k === 'grab')).toHaveLength(5);
  });
  it('poseMoved: a one-hand hold counts as moved over 3 cm or 15 degrees', () => {
    const p = { x: 0, y: 1, z: -0.5 }, q = { x: 0, y: 0, z: 0, w: 1 };
    expect(poseMoved(p, q, { x: 0.02, y: 1, z: -0.5 }, q)).toBe(false);
    expect(poseMoved(p, q, { x: 0.04, y: 1, z: -0.5 }, q)).toBe(true);
    const turn = deg => ({ x: 0, y: Math.sin(deg * Math.PI / 360), z: 0, w: Math.cos(deg * Math.PI / 360) });
    expect(poseMoved(p, q, p, turn(10))).toBe(false);
    expect(poseMoved(p, q, p, turn(20))).toBe(true);
    expect(poseMoved(p, q, p, { x: -0, y: -0, z: -0, w: -1 })).toBe(false); // the same rotation (q and -q)
    expect(poseMoved(null, q, p, q)).toBe(false);
  });
  it('vr-view.js emits the tutorial signals where the operation really happens', () => {
    const v = src['vr-view.js'];
    expect(v).toContain("if(grab1&&poseMoved(grabP,grabQ,holder.position,holder.quaternion))emit('grab-move');grab1=null;");
    expect(v).toContain("if(grabbing.size>grabN)emit('grab');grabN=grabbing.size;");
    // review: 正面に戻す drops the grab (grabbing.clear()); the grab bookkeeping goes with it, else the next grip change compares against the pose before the jump and fires grab-move
    expect(v).toContain('const bringVolumeFront=()=>{readHead();scene.attach(holder);grabbing.clear();twoHand=null;grabN=0;grab1=null;');
    expect(v).toContain("sp.obj.translateX(-scroll*SCROLL_SPEED*dt/ps);if(!sweepOn)emit('section-scroll');");
    expect(v).toContain("menu.refresh();emit('slice-toggle');if(ui.sliceClear)emit('slice-clear')};");
    expect(v).toContain("if(v&&was===2)emit('seg-show');else if(!v&&was!==2)emit('seg-hide')");
    expect(v).toContain("if(j===2&&m!==2)emit('seg-hide');else if(j!==2&&m===2)emit('seg-show');segMode[key]=j");
    expect(v).not.toContain("emit('move')");
    expect(v).not.toContain('createMoveTracker');
  });
  it('scale threshold is 15 %', () => {
    expect(scaleChanged(1, 1.14)).toBe(false);
    expect(scaleChanged(1, 1.2)).toBe(true);
    expect(scaleChanged(1, 0.8)).toBe(true);
  });
});
