import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PART_OWN, partUniforms } from '../../docs/vr-part-view.js';
import { STEP_CHOICES, stepChoiceScale, STEP_VOXELS, STEP_LEVELS, marchStep } from '../../docs/vr-auto-quality.js';

// the base ray-march step is chosen in the VR menu (画質 tab) and reaches the shader as the stepSize uniform
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

describe('step choices', () => {
  it('0.85 / 1.0 / 1.25 / 1.5 (default) voxels', () => {
    expect(STEP_CHOICES).toEqual([0.85, 1, 1.25, 1.5]);
    expect(STEP_CHOICES[0]).toBe(STEP_VOXELS);
  });
  it('choice 0 (0.85) scales by exactly 1, and an index out of range falls back to it', () => {
    expect(stepChoiceScale(0)).toBe(1);
    expect(stepChoiceScale(99)).toBe(1); // out of range: the default
  });
  it('a choice gives its voxel step: marchStep x scale = choice x the smallest voxel side', () => {
    const halfExt = [1, 1, 0.5], dims = [256, 256, 256], vox = Math.min(...[0, 1, 2].map(i => 2 * halfExt[i] / dims[i]));
    STEP_CHOICES.forEach((c, i) => expect(marchStep(halfExt, dims) * stepChoiceScale(i)).toBeCloseTo(c * vox, 12));
  });
  it('the quality rungs multiply the chosen base', () => {
    const base = marchStep([1, 1, 1], [256, 256, 256]);
    STEP_LEVELS.forEach(m => expect(base * stepChoiceScale(3) * m).toBeCloseTo(base * (1.5 / 0.85) * m, 12));
  });
});

describe('vr-view.js wiring', () => {
  it('every write of the stepSize uniform of the primary volume goes through stepFor (base x choice x rung)', () => {
    expect(src).not.toMatch(/stepSize\.value=baseStep\*/);
    expect((src.match(/material\.uniforms\.stepSize\.value=stepFor\(/g) || []).length).toBe(3);
    expect(src).toContain('const stepFor=k=>baseStep*stepChoiceScale(stepSel)*(STEP[k]??1);');
  });
  it('the partner volume takes the primary step by ratio, so the choice reaches it too', () => {
    expect(src).toContain('u2.stepSize.value=baseStep>0?pt.baseStep*u.stepSize.value/baseStep:pt.baseStep;');
  });
  it('the 画質 tab has the choice row, applied live without a rebuild and not saved', () => {
    const tab = src.slice(src.indexOf('}else if(ui.tab===3){'), src.indexOf('}else if(ui.tab===5){'));
    expect(tab).toContain("choice(y0+540,L.stp,STEP_CHOICES.map((c,i)=>({label:c===1?'1.0':String(c),value:i})),stepSel,v=>{stepSel=v;applyQuality()});");
    expect(src).toContain("stp:'刻み'"); expect(src).toContain("stp:'Step'");
    expect(src).toContain('let stepSel=3,'); // a session starts at 1.5 voxels
    expect(STEP_CHOICES[3]).toBe(1.5);
    expect(src).not.toMatch(/settings\.stepSel|DEFAULTS[^;]*stepSel/);
  });
  it('the part programs share the body\'s stepSize object (not a part-owned uniform), so the choice reaches parts too', () => {
    expect(PART_OWN).not.toContain('stepSize');
    const body = { stepSize: { value: 1 } }, u = partUniforms(body, { boxC: { value: 0 } });
    expect(u.stepSize).toBe(body.stepSize);
  });
  it('the step is a uniform of the shader and the 4096 iteration cap is unchanged', () => {
    expect(src).toContain('uniform float stepSize;');
    expect((src.match(/for\(int iter=0;iter<4096;iter\+\+\)/g) || []).length).toBe(3);
  });
});
