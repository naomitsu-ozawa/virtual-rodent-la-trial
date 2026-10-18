// Explore how far a set of top-level declarations can be moved out of a
// module: starting from seed names, pull in every top-level function/const
// they reference (transitively), and stop at `let`/`var` bindings (which an
// importing module cannot reassign). Prints the movable closure and the
// blockers, so a split can be planned before running extract-module.
//
//   node tools/closure.mjs docs/app.js seedA seedB ...
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { readFileSync } from 'node:fs';

const [path, ...seeds] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const src = readFileSync(path, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
const top = new Map();
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') top.set(n.id.name, { kind: n.type === 'ClassDeclaration' ? 'class' : 'fn', node: n });
  else if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') top.set(d.id.name, { kind: n.kind, node: d, init: d.init });
}
const refs = name => {
  const out = new Set(), { node } = top.get(name);
  // acorn-walk reports assignment targets as 'VariablePattern'; visit both.
  const visit = (id, _s, anc) => {
    if (id.type !== 'Identifier') return;
    const p = anc[anc.length - 2];
    if (p?.type === 'MemberExpression' && p.property === id && !p.computed) return;
    if (p?.type === 'Property' && p.key === id && !p.computed && !p.shorthand) return;
    if ((p?.type === 'MethodDefinition' || p?.type === 'PropertyDefinition') && p.key === id) return;
    if (top.has(id.name) && id.name !== name) out.add(id.name);
  };
  walk.ancestor(node, { Identifier: visit, VariablePattern: visit });
  return out;
};
const lineOf = pos => src.slice(0, pos).split('\n').length;
const isDomConst = n => { const t = top.get(n); return t.kind === 'const' && t.init && /\$\(|querySelector|getElementById|document\./.test(src.slice(t.init.start, Math.min(t.init.end, t.init.start + 120))); };
const moved = new Set(), blockers = new Map(), queue = [...seeds];
while (queue.length) {
  const n = queue.pop();
  if (moved.has(n)) continue;
  const t = top.get(n);
  if (!t) { console.error('unknown', n); process.exit(2); }
  if (t.kind === 'let' || t.kind === 'var' || isDomConst(n)) continue;
  moved.add(n);
  for (const r of refs(n)) {
    const k = top.get(r).kind;
    if (k === 'let' || k === 'var' || isDomConst(r)) (blockers.get(r) || blockers.set(r, new Set()).get(r)).add(n);
    else if (!moved.has(r)) queue.push(r);
  }
}
let lines = 0; for (const n of moved) { const nd = top.get(n).node; lines += lineOf(nd.end) - lineOf(nd.start) + 1; }
console.log(`closure: ${moved.size} declarations (~${lines} lines)`);
console.log('blockers (let/var or DOM-element consts) -> used by:');
for (const [b, users] of [...blockers].sort((a, b) => b[1].size - a[1].size)) console.log(`  ${b} [${isDomConst(b) ? 'DOM' : top.get(b).kind}] <- ${users.size}: ${[...users].slice(0, 6).join(', ')}${users.size > 6 ? ', …' : ''}`);
if (process.argv.includes('--list')) console.log([...moved].join(' '));
