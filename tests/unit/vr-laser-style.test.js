// the VR laser look is a menu preference (laserStyle: 0 line, 1 thin beam, 2 wide beam = default since the hands-on event)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const grab = re => { const m = re.exec(src); if (!m) throw new Error('not found: ' + re); return m[0]; };
const defaultsLine = grab(/const DEFAULTS=\{cap:1,[^\n]*\};/), looksLine = grab(/const LASER_COLOR=[^\n]*\nconst LASER_LOOKS=[^\n]*\n/), laserFn = grab(/const makeLaser=\(\)=>\{[\s\S]*?return r\};/);
const make = () => new Function('THREE', 'DEFAULT_WHEEL', 'LABEL_HIDE_DEFAULT', `${defaultsLine}\n${looksLine}\n${laserFn}\nreturn {DEFAULTS,laserLookOf,LASER_LOOKS,LASER_COLOR,makeLaser};`)(THREE, [1, 2, 3], 1);

describe('laser style setting', () => {
  const { DEFAULTS, laserLookOf } = make();
  it('defaults to 2 (wide beam, 帯・太) and is validated: 0..2 kept, anything else falls back to the default', () => {
    expect(DEFAULTS.laserStyle).toBe(2);
    for (const [v, k] of [[0, 0], [1, 1], [2, 2], ['2', 2], [1.4, 1], [3, 2], [-1, 2], [NaN, 2], [undefined, 2], [null, 2], ['', 2], ['x', 2]]) expect(laserLookOf(v)).toBe(k);
  });
  it('is a saved menu preference only: not a view value (the event reset keeps it), reset to 帯・太 once by dv 4 only, no URL parameter', () => {
    expect(grab(/const EVENT_VIEW_KEYS=\[[^\]]*\]/)).not.toContain('laserStyle');
    expect(grab(/const DEFAULTS_VERSION=4,DEFAULTS_VERSION_KEYS=[^\n]*\]\];/)).toContain("[4,['laserStyle']]");
    expect(grab(/const DEFAULTS_VERSION=4,DEFAULTS_VERSION_KEYS=\[[^\]]*\]/)).not.toContain('laserStyle');
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
    r.userData.setLook(99); expect(r.userData.look()).toBe(2);
    expect(makeLaser().userData.look()).toBe(2); // a new laser starts in the default look: 帯・太 (3 mm constant)
    expect(makeLaser().material.uniforms.width.value * 2).toBeCloseTo(0.003, 6);
  });
  it('colour / opacity / depthTest / renderOrder written on the ray reach the line too; neither is hit by a raycast', () => {
    const r = makeLaser(), l = line(r);
    r.material.color.setHex(0xff7a3d); expect(l.material.color.getHex()).toBe(0xff7a3d);
    expect(make().LASER_COLOR).toBe(0x00ff99); const f = make().makeLaser(); expect(f.material.color.getHex()).toBe(0x88ccff); expect(line(f).material.color.getHex()).toBe(0x88ccff);
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

describe('laser thickness does not depend on beam length or hit / no hit', () => {
  it('width taper is a function of the distance from the hand (reaches the tip width at 1 m), not of the beam length', () => {
    expect(laserFn).toContain('mix(1.,taper,min(t*L,1.))');
    const w = (t, L, taper = 0.3) => 1 - (1 - taper) * Math.min(t * L, 1);
    expect(w(0.5 / 0.6, 0.6)).toBeCloseTo(w(0.5 / 3, 3), 9); // 0.5 m from the hand, short vs long beam
    expect(w(1, 0.6)).toBeCloseTo(0.58, 9); expect(w(1, 3)).toBeCloseTo(0.3, 9);
  });
  it('the lighter no-hit opacity (0.6) keeps the visible edge: alpha at the old visible edge equals that of a full-opacity beam', () => {
    expect(laserFn).toContain('float p=max(2.-log(max(opacity,0.05))/log(0.22),0.3)');
    const p = o => Math.max(2 - Math.log(Math.max(o, 0.05)) / Math.log(0.22), 0.3), a = (e, o) => Math.pow(e, p(o)) * o;
    expect(p(1)).toBeCloseTo(2, 9); expect(a(0.22, 0.6)).toBeCloseTo(a(0.22, 1), 9);
    expect(a(0.5, 0.6)).toBeLessThan(a(0.5, 1)); // still fainter overall
  });
  it('no-hit is 0.6 m long at 0.6 opacity (was 0.35)', () => { expect(src).toContain('else{ray.scale.z=0.6;ray.material.opacity=0.6}'); });
});

describe('laser colour: spring green for the LEFT hand only (right keeps its orange hand colour)', () => {
  it('left beam and hit dot take LASER_COLOR, the right hand the orange hand colour; hand colours stay for the other uses', () => {
    expect(src).toContain('HAND_COLORS={right:0xff7a3d,left:0x7c6cff}');
  });
});

describe('laser colour helper (laserColorOf) is shared by the laser, its dot and the held-frame glow', () => {
  it('left = LASER_COLOR, right = its hand colour; the ray / dot line uses the helper', () => {
    expect(src).toContain("laserColorOf=c=>c.userData.source?.handedness==='left'?LASER_COLOR:handColor(c)");
    expect(src).toContain('const hc=laserColorOf(c),dot=c.userData.dot;ray.material.color.setHex(hc);dot.material.color.setHex(hc);');
  });
});

describe('surface / section cursor takes the pointing hand\'s laser colour', () => {
  it('both placers pass laserColorOf(c) to the cursor', () => {
    expect(src).toContain('surfCursors[controllers.indexOf(c)].set(tmpSc,tmpSh,Math.min(vs[0]*tmpSs.x,vs[1]*tmpSs.y,vs[2]*tmpSs.z),laserColorOf(c));');
    expect(src).toContain('cur.set(tmpSc,tmpSh,Math.min(vs[0]*tmpSs.x,vs[1]*tmpSs.y,vs[2]*tmpSs.z),laserColorOf(c));');
  });
});

describe('section frame glow: white when pointed at, the holding hand\'s laser colour when held', () => {
  const block = grab(/if\(section\.on\)\{const glowBy=new Map\(\);[^\n]*\n[^\n]*\n[^\n]*\n/);
  it('the held pass (drag / press on a section) uses laserColorOf, the point pass uses white and never overrides a held frame', () => {
    expect(block).toContain('const pr=c.userData.press,pl=c.userData.drag?.pl||(pr?.res?.kind===\'section\'?pr.res.ref?.pl:null);if(pl&&!glowBy.has(pl))glowBy.set(pl,laserColorOf(c))');
    expect(block).toContain('const rr=c.userData.res,nr=handIn.reach(c)');
    expect(block).toContain('if(pl&&!glowBy.has(pl))glowBy.set(pl,0xffffff)');
    expect(block.indexOf('glowBy.set(pl,laserColorOf(c))')).toBeLessThan(block.indexOf('glowBy.set(pl,0xffffff)'));
    expect(block).not.toContain('handColor(');
  });
  it('behaviour: simulate the two passes', () => {
    const LASER = 0x00ff99, ORANGE = 0xff7a3d, WHITE = 0xffffff;
    const colorOf = c => (c.hand === 'left' ? LASER : ORANGE);
    const run = cs => { const m = new Map(); for (const c of cs) { const pl = c.drag ?? c.press; if (pl && !m.has(pl)) m.set(pl, colorOf(c)); } for (const c of cs) { const pl = c.hover; if (pl && !m.has(pl)) m.set(pl, WHITE); } return m; };
    expect(run([{ hand: 'left', hover: 'A' }, { hand: 'right' }]).get('A')).toBe(WHITE);
    expect(run([{ hand: 'left', drag: 'A', hover: 'A' }, { hand: 'right' }]).get('A')).toBe(LASER);
    expect(run([{ hand: 'left' }, { hand: 'right', press: 'A', hover: 'A' }]).get('A')).toBe(ORANGE);
    expect(run([{ hand: 'left', hover: 'A' }, { hand: 'right', drag: 'A' }]).get('A')).toBe(ORANGE); // a hold beats the other hand's hover
    expect(run([{ hand: 'left', hover: 'B' }, { hand: 'right', drag: 'A' }]).get('B')).toBe(WHITE);
  });
});
