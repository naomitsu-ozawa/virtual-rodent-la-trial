// the VR laser look is a menu preference (laserStyle: 0 line, 1 thin beam = default, 2 wide beam)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const grab = re => { const m = re.exec(src); if (!m) throw new Error('not found: ' + re); return m[0]; };
const defaultsLine = grab(/const DEFAULTS=\{cap:1,[^\n]*\};/), looksLine = grab(/const LASER_LOOKS=[^\n]*\n/), laserFn = grab(/const makeLaser=\(\)=>\{[\s\S]*?return r\};/);
const make = () => new Function('THREE', 'DEFAULT_WHEEL', 'LABEL_HIDE_DEFAULT', `${defaultsLine}\n${looksLine}\n${laserFn}\nreturn {DEFAULTS,laserLookOf,LASER_LOOKS,makeLaser};`)(THREE, [1, 2, 3], 1);

describe('laser style setting', () => {
  const { DEFAULTS, laserLookOf } = make();
  it('defaults to 1 (thin beam) and is validated / clamped to 0..2', () => {
    expect(DEFAULTS.laserStyle).toBe(1);
    for (const [v, k] of [[0, 0], [1, 1], [2, 2], ['2', 2], [1.4, 1], [3, 1], [-1, 1], [NaN, 1], [undefined, 1], [null, 1], ['', 1], ['x', 1]]) expect(laserLookOf(v)).toBe(k);
  });
  it('is a saved menu preference only: not a view value, not in the start-value steps, no URL parameter', () => {
    expect(grab(/const EVENT_VIEW_KEYS=\[[^\]]*\]/)).not.toContain('laserStyle');
    expect(grab(/const DEFAULTS_VERSION=3,[^\n]*\]\];/)).not.toContain('laserStyle');
    expect(src).not.toMatch(/searchParams[^;]*laser/i);
  });
  it('menu row: ja / en labels, three options, saved on press', () => {
    expect(src).toContain("laserL:'レーザーの見た目',laserV:['線','帯・細','帯・太']"); expect(src).toContain("laserL:'Laser look',laserV:['Line','Beam thin','Beam wide']");
    expect(src).toContain('choice(yb-160,L.laserL,L.laserV.map((t,i)=>({label:t,value:i})),laserLookOf(settings.laserStyle),v=>{settings.laserStyle=v;saveSettings(settings)});');
    expect(src).toContain('ray.userData.setLook(settings.laserStyle)');
  });
});

describe('laser object per style', () => {
  const { makeLaser } = make();
  const line = r => r.children.find(c => c.isLine);
  it('0 = the 1 px line (beam draws nothing), 1 = beam 2 mm tapering to 0.6 mm, 2 = beam 3 mm constant', () => {
    const r = makeLaser();
    r.userData.setLook(1); expect(r.userData.look()).toBe(1); expect(line(r).visible).toBe(false); expect(r.geometry.drawRange.count).toBe(Infinity);
    expect(r.material.uniforms.width.value * 2).toBeCloseTo(0.002, 6); expect(r.material.uniforms.width.value * 2 * r.material.uniforms.taper.value).toBeCloseTo(0.0006, 6);
    r.userData.setLook(2); expect(r.material.uniforms.width.value * 2).toBeCloseTo(0.003, 6); expect(r.material.uniforms.taper.value).toBe(1); expect(line(r).visible).toBe(false);
    r.userData.setLook(0); expect(line(r).visible).toBe(true); expect(r.geometry.drawRange.count).toBe(0);
    const pos = line(r).geometry.attributes.position; expect([pos.getZ(0), pos.getZ(1)]).toEqual([0, -1]); expect(line(r).material.isLineBasicMaterial).toBe(true);
    r.userData.setLook(99); expect(r.userData.look()).toBe(1);
  });
  it('colour / opacity / depthTest / renderOrder written on the ray reach the line too; neither is hit by a raycast', () => {
    const r = makeLaser(), l = line(r);
    r.material.color.setHex(0xff7a3d); expect(l.material.color.getHex()).toBe(0xff7a3d);
    r.material.opacity = 0.35; expect(l.material.opacity).toBe(0.35); expect(r.material.uniforms.opacity.value).toBe(0.35);
    r.material.depthTest = false; expect(l.material.depthTest).toBe(false); expect(r.material.depthTest).toBe(false);
    r.renderOrder = 8; expect(l.renderOrder).toBe(8);
    const rc = new THREE.Raycaster(); rc.ray.set(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
    expect(rc.intersectObject(r, true)).toEqual([]);
  });
});

describe('表示 tab rows with the laser row (static)', () => {
  it('rows are 80 px apart (72 px tall) from the first row to the home row, below the four segment rows and inside the menu', () => {
    const MENU_H = 1180, yb = MENU_H - 110, rows = [480, 400, 320, 240, 160, 80].map(k => yb - k);
    for (const k of [480, 400, 320, 240, 160, 80]) expect(src).toMatch(new RegExp(`yb-${k}[,);]`));
    expect(rows[0]).toBeGreaterThanOrEqual(270 + 3 * 76 + 72);
    for (let i = 1; i < rows.length; i++) expect(rows[i]).toBeGreaterThanOrEqual(rows[i - 1] + 72);
    expect(yb).toBeGreaterThanOrEqual(rows[5] + 72); expect(yb + 72).toBeLessThanOrEqual(MENU_H);
    expect(src).toContain("label(X,yb-66,L.menuKey,"); expect(src).toContain("label(X,yb-32,L.menuGrab"); // the controller-only help lines sit between the laser row (ends yb-88) and the home row
  });
});
