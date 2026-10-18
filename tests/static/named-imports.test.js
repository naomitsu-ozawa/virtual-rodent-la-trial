import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as acorn from 'acorn';

// A named import of something the target module does not export is a
// SyntaxError when the module graph loads, so the whole app fails to start.
// Build 255 removed an export that app.js still imported, and CI did not notice.
const DOCS = join(import.meta.dirname, '..', '..', 'docs');
const files = readdirSync(DOCS).filter(f => f.endsWith('.js'));
const parse = f => acorn.parse(readFileSync(join(DOCS, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
const asts = Object.fromEntries(files.map(f => [f, parse(f)]));

function exportsOf(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const d = node.declaration;
    if (d?.declarations) for (const decl of d.declarations) names.add(decl.id.name);
    else if (d?.id) names.add(d.id.name);
    for (const s of node.specifiers || []) names.add(s.exported.name);
  }
  return names;
}

describe('named imports between docs/ modules', () => {
  it.each(files)('%s imports only names its local modules export', file => {
    const missing = [];
    for (const node of asts[file].body) {
      if (node.type !== 'ImportDeclaration') continue;
      const m = /^\.\/([^?]+)/.exec(node.source.value);
      if (!m || !asts[m[1]]) continue;
      const exported = exportsOf(asts[m[1]]);
      for (const s of node.specifiers) if (s.type === 'ImportSpecifier' && !exported.has(s.imported.name)) missing.push(s.imported.name + ' from ' + m[1]);
    }
    expect(missing).toEqual([]);
  });
});
