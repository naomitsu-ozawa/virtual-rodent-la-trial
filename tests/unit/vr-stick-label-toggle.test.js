import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
describe('stick click short press with no section toggles the labels (VR)', () => {
  it('no section at all: labels; otherwise the slice toggle as before; the hold stays the frames', () => {
    expect(v).toContain("if(ev==='short'&&!planes.length)toggleLabelsHidden(c);");
    expect(v).toContain("else if(ev==='short')toggleSliceClear(c);");
    expect(v).toContain("else if(ev==='long')toggleFramesHidden(c);");
  });
  it('labelsHidden hides every card in placeLabel (after the segment-hidden check) and the session reset clears it', () => {
    expect(v).toMatch(/if\(lb\.hid\)\{[^\n]*\n\s*if\(labelsHidden\)\{lb\.m\.visible=false;lb\.line\.visible=false;return\}/);
    expect(v.match(/labelsHidden=false;ui\.sliceClear=false;/g).length).toBe(2);
  });
});
