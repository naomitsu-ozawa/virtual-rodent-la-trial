import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// build 474 regression: an edit put "scene.add(dot);c.userData.dot=dot;" after a // comment on the same line,
// so c.userData.dot was undefined and the per-frame loop threw (dot.material) -> VR/AR showed nothing.
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const codeOf = line => { const i = line.indexOf('//'); return i < 0 ? line : line.slice(0, i); };

describe('vr-view.js laser end dot', () => {
  it('registers each controller dot as code, not inside a comment', () => {
    const lines = src.split('\n').filter(l => l.includes('c.userData.dot=dot'));
    expect(lines.length).toBe(1);
    expect(codeOf(lines[0])).toContain('c.userData.dot=dot');
    expect(codeOf(lines[0])).toContain('scene.add(dot)');
  });
  it('no line comment swallows a statement (a comment glued to code like "themscene.add(")', () => {
    const bad = src.split('\n').filter(l => { const i = l.indexOf('//'); return i >= 0 && /[a-z](scene|c\.userData|ctx|mesh)\.[a-zA-Z]+\(/.test(l.slice(i)); });
    expect(bad).toEqual([]);
  });
});
