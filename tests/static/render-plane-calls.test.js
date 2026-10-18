import { describe, it, expect } from 'vitest';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { readFileSync, readdirSync } from 'node:fs';

// renderPlane(p, revision, idx) returns immediately unless `revision` equals
// the current planeRenderRevision[p]. Calling it without a revision silently
// draws nothing — this hid every 2D filter preview (GPU and full-resolution
// paths) from at least build 150 until 191. Use safeRenderPlane(p) or pass
// ++planeRenderRevision[p] and the slice index.
describe('renderPlane call sites', () => {
  const files = readdirSync('docs').filter(f => f.endsWith('.js'));
  it.each(files)('%s: every renderPlane(...) call passes revision and index', file => {
    const src = readFileSync(`docs/${file}`, 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    const bad = [];
    walk.simple(ast, {
      CallExpression(n) {
        if (n.callee.type === 'Identifier' && n.callee.name === 'renderPlane' && n.arguments.length < 3)
          bad.push(`line ${src.slice(0, n.start).split('\n').length}: ${src.slice(n.start, n.end).slice(0, 80)}`);
      },
    });
    expect(bad).toEqual([]);
  });
});
