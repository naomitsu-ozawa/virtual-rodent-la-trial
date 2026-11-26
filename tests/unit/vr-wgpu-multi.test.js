// A frame of several volumes (the pair partner, later the parts): the depth axis of the display's programs (docs/vr-wgsl-depth.js), the volume renderer's draw with extra volumes, the data sources of the new ways being per volume.
import { describe, it, expect, vi } from 'vitest';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl } from '../../docs/vr-wgsl-core.js';
import { generalWgsl } from '../../docs/vr-wgsl-general.js';
import { depthWgsl, DEPTH_FORMAT, depthState } from '../../docs/vr-wgsl-depth.js';
import { newPathText, DISPLAY_MODES, GENERAL_MODES } from '../../docs/vr-wgpu-newpath.js';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import { GPU_GLOBALS, recordingDevice, sceneUniforms, eyeCam } from '../helpers/gpu-call-log.js';

const withGpu = fn => async () => { for (const [k, v] of Object.entries(GPU_GLOBALS)) vi.stubGlobal(k, v); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));

describe('the depth axis text', () => {
  it('every way of every feature: the volume\'s own text is kept (its fragment entry renamed fsMain, nothing else changed), a new fs writes the two colour outputs unchanged and frag_depth, and the text parses', () => {
    for (const feat of [null, { R: true }, { R: true, C: true }, { C: true, T: true }]) for (const mode of [...DISPLAY_MODES, ...GENERAL_MODES]) {
      const base = newPathText({ f16: false, cls4: false, mode, feat }), z = depthWgsl(base);
      expect(() => new WgslReflect(z), mode).not.toThrow();
      expect(z.startsWith(base.replace('@fragment fn fs(in:VOut)->FOut{', 'fn fsMain(in:VOut)->FOut{')), mode).toBe(true);
      expect(z).toContain('@builtin(frag_depth) z:f32'); expect(z).toContain('o.color=fo.color;o.depth=fo.depth;o.z=1.0;'); expect(z).toContain('round(clamp(fo.color.a,0.0,1.0)*255.0)>0.0'); expect(z).toContain('/16777215.0;');
    }
  });
  it('the volume\'s own texts are not changed by it (the feature-less text has no depth member: tests/unit/wgsl-text-hash.test.js pins the bytes)', () => {
    for (const t of [volumeWgsl({}), volumeWgsl({ events: true }), generalWgsl({})]) { expect(t).not.toContain('frag_depth'); expect(t).not.toContain('fsMain'); }
  });
  it('the entry is found exactly once or it throws; the pipeline state is the depth32float less-equal one', () => {
    expect(() => depthWgsl('nothing')).toThrow(/fragment entry/);
    const t = volumeWgsl({}); expect(() => depthWgsl(t + t)).toThrow(/exactly once/);
    expect(DEPTH_FORMAT).toBe('depth32float'); expect(depthState()).toEqual({ format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less-equal' });
  });
});

describe('the renderer draws several volumes into one target', () => {
  const mkR = () => { const rec = recordingDevice({}), passes = [], ce = rec.device.createCommandEncoder; rec.device.createCommandEncoder = () => { const e = ce(), b = e.beginRenderPass; e.beginRenderPass = d => { passes.push(d); return b(d); }; return e; }; const r = createVrVolumeRenderer({ THREE: THREEG, device: rec.device, halfExt: [1, 1, 1] }); return { r, passes, ...rec }; };
  const second = u => { const o = sceneUniforms(16); for (const k of Object.keys(u)) if (!(k in o)) o[k] = u[k]; return o; }; // another volume: its own textures
  const frame = (r, u, extras, over = {}) => r.draw({ u, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 0.5, fov: false, fp: 0.5, rects: null, band: 1, variant: { cls4: false, events: false }, extras, ...over });
  it('a frame of several volumes is ONE render pass: it clears the colour, the packed depth and the depth buffer once (the depth buffer is never stored: nothing reads it after the pass), every volume is drawn in it with its own uniforms (their own buffers) and its own bind group; one volume draws as before (no depth attachment)', withGpu(async () => {
    const { r, passes } = mkR(), u = sceneUniforms(16), u2 = second(u), M2 = new THREEG.Matrix4().makeTranslation(0.5, 0, 0);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]); await r.preload(u2, [{ cls4: false, events: false, multi: true }]);
    for (let i = 0; i < 4; i++) frame(r, u, null); const single = passes.slice(); passes.length = 0;
    expect(single.every(d => d.colorAttachments.length === 2 && !d.depthStencilAttachment && d.colorAttachments.every(a => a.loadOp === 'clear'))).toBe(true);
    const singles = single.length / 4;
    for (let i = 0; i < 4; i++) frame(r, u, [{ u: u2, model: M2, order: 1.5, boxes: null }]);
    expect(passes.length).toBe(4 * singles); // the same number of render passes as a frame of the body alone (the part's draws are in the body's pass)
    for (const d of passes) { expect(d.colorAttachments.every(a => a.loadOp === 'clear' && a.storeOp === 'store')).toBe(true); expect(d.depthStencilAttachment).toMatchObject({ depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 }); }
    expect(r.stats.np).toMatchObject({ use: true }); // the body's own decision is the frame's (the partner's is its own)
    const t = r.volume.fixedTarget('low', 500, 500); expect(t.z).toBeTruthy(); expect(t.z.desc?.format ?? t.z.d?.format).toBe('depth32float');
    r.dispose();
  }));
  it('the volumes of one pass have tiles of their own (a second volume does not make the first one\'s tiles over: the pass reads them all after every pre-pass has run)', withGpu(async () => {
    const { r, log } = mkR(), u = sceneUniforms(16), u2 = second(u), M2 = new THREEG.Matrix4().makeTranslation(0.5, 0, 0);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]); await r.preload(u2, [{ cls4: false, events: false, multi: true }]);
    for (let i = 0; i < 6; i++) frame(r, u, [{ u: u2, model: M2, order: 1.5, boxes: null }]);
    const slots = [...r.volume.displayNp().inst.cd.state.tileSets.keys()];
    expect(slots).toContain('low'); expect(slots).toContain('low:1');
    r.dispose();
  }));
  it('each volume of the pass is drawn only inside its own box (the scissors of the pass cut down to the box\'s rect, the region itself is the union); a volume whose rect is outside the pass has no draw; one volume with no rects is drawn over the whole region as before', withGpu(async () => {
    const { r, log } = mkR(), u = sceneUniforms(16), u2 = second(u), M2 = new THREEG.Matrix4().makeTranslation(0.5, 0, 0);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]); await r.preload(u2, [{ cls4: false, events: false, multi: true }]);
    const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
    const area = lines => lines.reduce((a, l) => { const [, , w, h] = l.split(' ')[1].split(',').map(Number); return a + w * h; }, 0);
    const run = (mainBoxes, partBoxes) => { for (let i = 0; i < 4; i++) frame(r, u, [{ u: u2, model: M2, order: 1.5, boxes: partBoxes }], { boxes: mainBoxes }); const n0 = log.length; frame(r, u, [{ u: u2, model: M2, order: 1.5, boxes: partBoxes }], { boxes: mainBoxes }); const l = log.slice(n0); const bp = l.findIndex(x => x.startsWith('beginRenderPass')), ends = l.findIndex((x, i) => i > bp && x === 'render.end'); return l.slice(bp, ends).filter(x => x.startsWith('render.setScissorRect') || x.startsWith('render.draw') || x.startsWith('render.setPipeline')); };
    const whole = run(null, null); // no rects: every volume over the whole region
    const sc = a => a.filter(x => x.startsWith('render.setScissorRect')), pipes = a => a.filter(x => x.startsWith('render.setPipeline'));
    expect(sc(whole).length).toBeGreaterThan(0); expect(pipes(whole).length).toBe(2); // two volumes, one pass
    const cut = run([rect(0, 0, 1000, 1000), rect(0, 0, 1000, 1000)], [rect(100, 100, 300, 300), rect(100, 100, 300, 300)]);
    expect(pipes(cut).length).toBe(2); expect(area(sc(cut))).toBeLessThan(area(sc(whole)));
    const gone = run([rect(0, 0, 1000, 1000), rect(0, 0, 1000, 1000)], [rect(0, 0, 0, 0), rect(0, 0, 0, 0)]);
    expect(area(sc(gone))).toBeLessThan(area(sc(cut)));
    r.dispose();
  }));
  it('prepareMulti makes the depth buffers of the pass targets that exist (a cut that starts does not make them in its first frame); the frame loop reports the volumes and passes of a frame and the way of each volume', withGpu(async () => {
    const { r } = mkR(), u = sceneUniforms(16), u2 = second(u);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]); await r.preload(u2, [{ cls4: false, events: false, multi: true }]);
    for (let i = 0; i < 3; i++) frame(r, u, null);
    expect(r.stats.volumes).toBe(1); expect(r.stats.passes).toBe(1); expect(r.stats.vways).toBe(null);
    const t = r.volume.fixedTarget('low', 500, 500); expect(t.z).toBeFalsy();
    r.prepareMulti(); expect(t.z).toBeTruthy();
    for (let i = 0; i < 5; i++) frame(r, u, [{ u: u2, model: new THREEG.Matrix4().makeTranslation(0.5, 0, 0), order: 1.5, boxes: null }]);
    expect(r.stats.volumes).toBe(2); expect(r.stats.passes).toBe(1); expect(r.stats.vways).toHaveLength(2); expect(r.stats.vways.some(x => x.startsWith('body '))).toBe(true); expect(r.stats.vways.some(x => x.startsWith('part '))).toBe(true);
    r.dispose();
  }));
  it('the new ways\' data is per source: two volumes with their own combined textures have their own distance textures and marks (the programs are made once); a volume nearer than the body (order below 1) is drawn first', withGpu(async () => {
    const { r, passes, log } = mkR(), u = sceneUniforms(16), u2 = second(u);
    await r.preload(u, [{ cls4: false, events: false, multi: true }]); await r.preload(u2, [{ cls4: false, events: false, multi: true }]);
    const np = r.volume.displayNp().inst, progs0 = np.pipes.size;
    for (let i = 0; i < 6; i++) frame(r, u, [{ u: u2, model: new THREEG.Matrix4(), order: 0.5, boxes: null }]);
    expect(np.sources).toBeGreaterThanOrEqual(3); // the programs' own + the body's + the partner's
    expect(np.pipes.size).toBe(progs0); // no program is made by a new source
    expect(passes.length).toBeGreaterThan(0);
    const writes = log.filter(l => l.startsWith('createTexture')).length; expect(writes).toBeGreaterThan(0);
    r.dispose();
  }));
});
