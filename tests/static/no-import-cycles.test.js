import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// The docs/*.js modules must form a DAG. Cycles appeared during the app.js
// split when functions were appended to existing modules (build 238: scene3d
// <-> mpr-render / edit-tools, ...). They happened to work because only
// functions were used across the cycle, but a top-level read across one would
// throw (TDZ) depending on evaluation order. Keep low-level modules free of
// imports from higher-level ones.
const graph = {};
for (const f of readdirSync('docs').filter(f => f.endsWith('.js'))) {
  const src = readFileSync(`docs/${f}`, 'utf8');
  graph[f] = [...src.matchAll(/from '\.\/([\w-]+\.js)/g)].map(m => m[1]);
}
function findCycle() {
  const state = {}, stack = [];
  const visit = n => {
    state[n] = 1; stack.push(n);
    for (const m of graph[n] || []) {
      if (!(m in graph)) continue;
      if (state[m] === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (!state[m]) { const c = visit(m); if (c) return c; }
    }
    state[n] = 2; stack.pop(); return null;
  };
  for (const n in graph) if (!state[n]) { const c = visit(n); if (c) return c; }
  return null;
}

describe('module graph', () => {
  it('has no import cycles', () => {
    expect(findCycle()).toBeNull();
  });
  it('no module imports app.js', () => {
    for (const [f, deps] of Object.entries(graph)) expect(deps.includes('app.js'), f).toBe(false);
  });
});
