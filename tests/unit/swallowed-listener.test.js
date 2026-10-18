import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as espree from 'espree';

// Regression: two statements had been appended on the same line after a `//` comment, so they never ran
//  - comment-ui.js (build 481): onMeasureStartChange(()=>{syncPulse();renderMeasures()}) -> the distance START never pulsed / never refreshed the list
//  - data-load.js (build 436): sigmoidCenter.disabled=!filterState.sigmoid in configure()
// These parse the real source and check the statements are code (not comment text) inside the right function.
const parse = f => espree.parse(readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', comment: true, range: true });
const walk = (n, cb) => { if (!n || typeof n.type !== 'string') return; cb(n); for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(x => walk(x, cb)); else if (v && typeof v === 'object') walk(v, cb); } };
const fn = (ast, name) => { let r; walk(ast, n => { if (n.type === 'FunctionDeclaration' && n.id.name === name) r = n; }); return r; };

describe('comment-ui.js installComments()', () => {
  const ast = parse('comment-ui.js'), body = fn(ast, 'installComments');
  it('registers the measure-start listener (syncPulse + renderMeasures)', () => {
    const calls = [];
    walk(body, n => { if (n.type === 'CallExpression' && n.callee.name === 'onMeasureStartChange') calls.push(n); });
    expect(calls).toHaveLength(1);
    const names = [];
    walk(calls[0].arguments[0], n => { if (n.type === 'CallExpression') names.push(n.callee.name); });
    expect(names).toEqual(expect.arrayContaining(['syncPulse', 'renderMeasures']));
  });
  it('still registers the measurements listener', () => {
    let found = false;
    walk(body, n => { if (n.type === 'CallExpression' && n.callee.name === 'onMeasurementsChange') found = true; });
    expect(found).toBe(true);
  });
  it('has no code after a // comment on one line', () => {
    const text = readFileSync(new URL('../../docs/comment-ui.js', import.meta.url), 'utf8');
    expect(text).not.toMatch(/no DOM rebuild per move\S/);
  });
});

describe('data-load.js configure()', () => {
  const ast = parse('data-load.js'), body = fn(ast, 'configure');
  it('sets sigmoidCenter.disabled from filterState.sigmoid', () => {
    let stmt;
    walk(body, n => {
      if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && n.left.object.name === 'sigmoidCenter' && n.left.property.name === 'disabled') stmt = n;
    });
    expect(stmt).toBeDefined();
    // right side: !filterState.sigmoid
    expect(stmt.right.type).toBe('UnaryExpression');
    expect(stmt.right.argument.object.name).toBe('filterState');
    expect(stmt.right.argument.property.name).toBe('sigmoid');
  });
});
