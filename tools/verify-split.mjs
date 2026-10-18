// Verify that a module split only MOVED code: every top-level declaration of
// the original file (from a git revision) appears byte-for-byte in exactly one
// of the current files, and nothing else was added besides imports/exports.
//
//   node tools/verify-split.mjs <git-rev> <original-path[,more-paths]> <current files...>
//   (list every file that existed at <git-rev> and is involved, comma-separated)
//   e.g. node tools/verify-split.mjs main docs/app.js docs/app.js docs/utils.js
import * as acorn from 'acorn';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [rev, origPath, ...files] = process.argv.slice(2);
const decls = src => {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const out = [];
  const add = n => {
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) out.push(`${n.kind} ${src.slice(d.start, d.end)}`);
    else if (n.type === 'ImportDeclaration') out.push('IMPORT ' + src.slice(n.start, n.end).replace(/\?v=[^'"]+/, ''));
    else out.push(src.slice(n.start, n.end));
  };
  for (const n of ast.body) n.type === 'ExportNamedDeclaration' && n.declaration ? add(n.declaration) : add(n);
  return out;
};
// Build markers are expected to change (npm run bump-build); compare without them.
const normalize = d => d.replace(/^(const APP_(?:VERSION|BUILD))='[^']*'$/, "$1='<build>'");
const count = arr => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
const before = count(origPath.split(',').flatMap(p => decls(execFileSync('git', ['show', `${rev}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 28 }))).filter(d => !d.startsWith('IMPORT ')).map(normalize));
const after = count(files.flatMap(f => decls(readFileSync(f, 'utf8'))).filter(d => !d.startsWith('IMPORT ')).map(normalize));
let bad = 0;
for (const [d, c] of before) if ((after.get(d) || 0) !== c) { bad++; console.log(`MISSING/DUPLICATED (${after.get(d) || 0}/${c}):`, d.slice(0, 120)); }
for (const [d, c] of after) if (!before.has(d)) { bad++; console.log('NEW CODE:', d.slice(0, 120)); }
console.log(bad ? `FAILED: ${bad} difference(s)` : `OK: ${[...before.values()].reduce((a, b) => a + b, 0)} top-level statements moved/kept verbatim`);
process.exit(bad ? 1 : 0);
