import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { MedicalVolumeRenderer } from '../../docs/medical-volume.js';
import { onDatasetChange } from '../../docs/dataset-reset.js';

// what the previous practice dataset left behind on a switch (memory, GPU and CPU). The release itself is spread over modules that cannot
// all be imported in node (vr-view.js pulls the whole DOM shell), so the pieces are tested here with mocks and the wiring by source checks; the real
// switch is covered by tests/e2e/dataset-switch-reset.spec.js.
beforeAll(() => {
  globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
});

describe('onDatasetChange', () => {
  it('runs on every vrl-serieschange (state.js setActiveSeries) and not otherwise', () => {
    const doc = new EventTarget(), fn = vi.fn();
    onDatasetChange(fn, doc);
    expect(fn).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event('vrl-serieschange'));
    doc.dispatchEvent(new Event('vrl-serieschange'));
    doc.dispatchEvent(new Event('something-else'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('a throwing release is reported but never reaches the series switch, and the next switch still releases', () => {
    const doc = new EventTarget(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    onDatasetChange(() => { n++; throw new Error('boom'); }, doc);
    expect(() => doc.dispatchEvent(new Event('vrl-serieschange'))).not.toThrow();
    doc.dispatchEvent(new Event('vrl-serieschange'));
    expect(n).toBe(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('does nothing without a document (node / worker)', () => {
    expect(() => onDatasetChange(() => {}, undefined)).not.toThrow();
  });
});

describe('MedicalVolumeRenderer.resetData() releases the GPU data of the previous series', () => {
  const mockDevice = () => ({
    buffers: [], textures: [],
    createBuffer(d) { const b = { label: d.label, size: d.size, destroyed: false, destroy() { b.destroyed = true; } }; this.buffers.push(b); return b; },
    createTexture(d) { const t = { label: d.label, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({}) }; this.textures.push(t); return t; },
    queue: { writeBuffer() {} },
  });
  const resident = () => {
    const device = mockDevice(), r = Object.create(MedicalVolumeRenderer.prototype);
    Object.assign(r, { device, canvas: { style: {} }, onStatus() {}, active: false, setActive(a) { r.active = !!a; } });
    // a resident series with an analysis result drawn: the volume texture, bricks, edit / preview / cut buffers, the overlay buffer and the region index texture
    r.texture = device.createTexture({ label: 'volume' }); r.brickBuffer = device.createBuffer({ label: 'bricks' });
    r.regionTexture = device.createTexture({ label: 'region index' }); r.regionTexSignature = 'sig'; r.regionTexInfo = '67 MB';
    r.analysisOverlayBuffer = device.createBuffer({ label: 'overlay' }); r.analysisOverlaySignature = 'sig';
    r.pipeline = { getBindGroupLayout: () => ({}) };
    return r;
  };
  it('destroys the region index texture and the overlay buffer (they were only released by the next clearAnalysisRuns)', () => {
    const r = resident(), { texture, brickBuffer, regionTexture, analysisOverlayBuffer } = r;
    r.resetData();
    expect(texture.destroyed).toBe(true);
    expect(brickBuffer.destroyed).toBe(true);
    expect(regionTexture.destroyed).toBe(true);
    expect(analysisOverlayBuffer.destroyed).toBe(true);
    expect(r.regionTexture).toBeNull();
    expect(r.regionTexSignature).toBe('');
    expect(r.analysisOverlaySignature).toBe(''); // the next sync rebuilds for the new grid (the signature carries the grid size)
  });
  it('leaves a bind group-free renderer that rebuilds on the next upload, and a later clearAnalysisRuns / destroy is safe', () => {
    const r = resident();
    r.resetData();
    expect(r.bindGroup).toBeNull();
    expect(r.texture).toBeNull();
    expect(() => r.clearAnalysisRuns()).not.toThrow();
    const live = r.device.buffers.filter(b => !b.destroyed).map(b => b.label);
    expect(live.every(l => /empty/.test(l))).toBe(true); // only the 8-byte placeholders remain
  });
});

describe('wiring (source checks)', () => {
  const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const fnBody = (src, head) => { const i = src.indexOf(head); expect(i).toBeGreaterThan(-1); return src.slice(i, src.indexOf('\n}\n', i)); };
  it('vr-view.js releases the prepared VR data on a dataset change, but never during a session', () => {
    expect(vr).toMatch(/onDatasetChange\(\(\)=>releaseVrPrepared\(\)\)/);
    const body = fnBody(vr, 'export function releaseVrPrepared()');
    expect(body).toMatch(/if\(running\)return false/);
    expect(body.indexOf('if(running)return false')).toBeLessThan(body.indexOf('prepared=null'));
    for (const part of ['prepared=null', 'preparing=null', 'disposeGpuPrepared()', 'hiddenMgr.release()', 'prepareGen++']) expect(body).toContain(part);
  });
  it('a preparation that finishes after the release is not kept, neither the CPU data nor the page-side GPU assets', () => {
    expect(vr).toMatch(/if\(gen===prepareGen\)prepared=P/);
    expect(vr).toMatch(/if\(gen!==prepareGen\)\{disposeGpuPrepared\(\);return null\}/);
  });
  it('the page-side WebGL context is ended with the textures (dispose() alone leaves it to the garbage collector)', () => {
    expect(fnBody(vr, 'export function disposeGpuPrepared()')).toContain('forceContextLoss');
  });
});
