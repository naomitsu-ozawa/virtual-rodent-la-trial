// Move top-level `let`/`var` bindings of a module into a separate state
// module, keeping every READ unchanged (ES module live bindings) and turning
// every WRITE into a call to a generated setter.
//
//   node tools/state-codemod.mjs <src.js> <state.js>
//
// Why: importing modules cannot assign to an imported binding, so feature code
// that writes shared state could not move out of app.js. After this codemod,
// state lives in <state.js> and can be read/written from any module.
//
// Rewrites (x is a moved binding, resolved with eslint-scope so locals that
// shadow the name are never touched):
//   x = e        -> setX(e)                 (setter returns the value, like =)
//   x op= e      -> setX(x op (e))          (arithmetic/bitwise compound ops)
//   x ||= e      -> (x || setX(e))          (also &&=, ??= ; short-circuit kept)
//   x++ / ++x    -> incX(false) / incX(true) (helper does x++ / ++x exactly)
//   x-- / --x    -> decX(false) / decX(true)
// Any other write form (destructuring, for-in/of target, ...) aborts.
// Only bindings whose initialiser is a literal / empty array / `new
// TypedArray(literal)` are moved, so evaluating them earlier changes nothing.
//
// Check the result with tools/verify-state-codemod.mjs.
import * as acorn from 'acorn';
import { analyze } from 'eslint-scope';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const [srcPath, statePath] = process.argv.slice(2);
if (!srcPath || !statePath) { console.error('usage: state-codemod.mjs <src.js> <state.js>'); process.exit(2); }
if (existsSync(statePath)) { console.error(`refusing to overwrite ${statePath}`); process.exit(2); }
const fail = m => { console.error('ABORT: ' + m); process.exit(1); };

const src = readFileSync(srcPath, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
const lineOf = pos => src.slice(0, pos).split('\n').length;

export const setterName = n => 'set' + n[0].toUpperCase() + n.slice(1);
export const incName = n => 'inc' + n[0].toUpperCase() + n.slice(1);
export const decName = n => 'dec' + n[0].toUpperCase() + n.slice(1);

const SAFE_CTORS = new Set(['Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Map', 'Set', 'WeakMap', 'WeakSet']);
const safeInit = n => !n || n.type === 'Literal'
  || (n.type === 'ArrayExpression' && n.elements.every(e => e && e.type === 'Literal'))
  || (n.type === 'ObjectExpression' && n.properties.length === 0)
  || (n.type === 'UnaryExpression' && n.argument.type === 'Literal')
  || (n.type === 'NewExpression' && n.callee.type === 'Identifier' && SAFE_CTORS.has(n.callee.name) && n.arguments.every(a => a.type === 'Literal'));

// 1. candidate bindings
const decls = []; // {name, stmt, decl}
for (const stmt of ast.body) {
  if (stmt.type !== 'VariableDeclaration' || stmt.kind === 'const') continue;
  for (const d of stmt.declarations) {
    if (d.id.type !== 'Identifier') fail(`destructuring top-level ${stmt.kind} at line ${lineOf(d.start)} not supported`);
    if (!safeInit(d.init)) { console.log(`skip ${d.id.name}: non-trivial initialiser (stays in ${basename(srcPath)})`); continue; }
    decls.push({ name: d.id.name, stmt, decl: d });
  }
}
const moved = new Map(decls.map(d => [d.name, d]));

// helper names must not collide with existing top-level names
const topNames = new Set();
for (const n of ast.body) {
  if (n.id?.name) topNames.add(n.id.name);
  if (n.type === 'VariableDeclaration') n.declarations.forEach(d => d.id.name && topNames.add(d.id.name));
  if (n.type === 'ImportDeclaration') n.specifiers.forEach(s => topNames.add(s.local.name));
}

// 2. resolve references with scope analysis
const scopes = analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
const moduleScope = scopes.globalScope.childScopes.find(s => s.type === 'module');
const parents = new Map();
(function link(node, parent) {
  if (!node || typeof node.type !== 'string') return;
  parents.set(node, parent);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && link(c, node));
    else if (v && typeof v.type === 'string') link(v, node);
  }
})(ast, null);

const ARITH = new Set(['+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=']);
const LOGICAL = new Set(['||=', '&&=', '??=']);
const sites = []; // {node, kind, name}
const helpers = new Map(); // name -> Set('set'|'inc'|'dec')
for (const [name] of moved) {
  const v = moduleScope.set.get(name);
  if (!v) fail(`no module-scope variable for ${name}`);
  helpers.set(name, new Set(['set']));
  for (const ref of v.references) {
    if (!ref.isWrite() || ref.init) continue;
    const id = ref.identifier, p = parents.get(id);
    if (p.type === 'AssignmentExpression' && p.left === id) {
      if (p.operator !== '=' && !ARITH.has(p.operator) && !LOGICAL.has(p.operator)) fail(`operator ${p.operator} at line ${lineOf(p.start)}`);
      sites.push({ node: p, kind: 'assign', name });
    } else if (p.type === 'UpdateExpression' && p.argument === id) {
      sites.push({ node: p, kind: 'update', name });
      helpers.get(name).add(p.operator === '++' ? 'inc' : 'dec');
    } else fail(`unsupported write to ${name} (${p.type}) at line ${lineOf(id.start)}`);
  }
}
for (const [name, kinds] of helpers) for (const k of kinds) {
  const h = k === 'set' ? setterName(name) : k === 'inc' ? incName(name) : decName(name);
  if (topNames.has(h)) fail(`generated helper ${h} collides with an existing name`);
}

// 3. rewrite (nested sites handled by recursive emission)
const siteByNode = new Map(sites.map(s => [s.node, s]));
const ordered = [...sites].sort((a, b) => a.node.start - b.node.start || b.node.end - a.node.end);
function emit(start, end) {
  let out = '', pos = start;
  for (const s of ordered) {
    const n = s.node;
    if (n.start < pos || n.end > end || n.start < start) continue; // outside, or nested in an emitted site
    out += src.slice(pos, n.start) + rewrite(s);
    pos = n.end;
  }
  return out + src.slice(pos, end);
}
function rewrite({ node: n, kind, name }) {
  if (kind === 'update') return `${n.operator === '++' ? incName(name) : decName(name)}(${n.prefix})`;
  const rhs = emit(n.right.start, n.right.end);
  if (n.operator === '=') return `${setterName(name)}(${rhs})`;
  if (ARITH.has(n.operator)) return `${setterName(name)}(${name}${n.operator.slice(0, -1)}(${rhs}))`;
  return `(${name}${n.operator.slice(0, -1)}${setterName(name)}(${rhs}))`;
}

// 4. remove moved declarations; build output
const edits = [];
const byStmt = new Map();
for (const d of decls) (byStmt.get(d.stmt) || byStmt.set(d.stmt, []).get(d.stmt)).push(d.decl);
for (const [stmt, ds] of byStmt) {
  if (ds.length === stmt.declarations.length) edits.push({ start: stmt.start, end: stmt.end, text: '', stmt: true });
  else {
    const keep = stmt.declarations.filter(d => !ds.includes(d)).map(d => emit(d.start, d.end));
    edits.push({ start: stmt.start, end: stmt.end, text: `${stmt.kind} ${keep.join(',')};` });
  }
}
// top-level statements outside removed declarations are emitted with rewrites
const bodyEdits = edits.sort((a, b) => a.start - b.start);
let out = '', pos = 0;
for (const e of bodyEdits) {
  out += emit(pos, e.start);
  let end = e.end;
  if (e.stmt) { // swallow the now-empty line
    const lineStart = out.lastIndexOf('\n') + 1;
    if (/^\s*$/.test(out.slice(lineStart)) && src[end] === '\n') end += 1;
  }
  out += e.text; pos = end;
}
out += emit(pos, src.length);

const tag = src.match(/\?v=([0-9]+-build[^'"&\s)]*)/)?.[1];
const importNames = [...moved.keys()].flatMap(n => [...helpers.get(n)].map(k => k === 'set' ? setterName(n) : k === 'inc' ? incName(n) : decName(n)).concat(n));
const importLine = `\nimport { ${importNames.sort().join(', ')} } from './${basename(statePath)}${tag ? `?v=${tag}` : ''}';`;
const lastImport = ast.body.filter(n => n.type === 'ImportDeclaration').at(-1);
// lastImport.end is before any edit position (imports come first)
const at = lastImport ? lastImport.end : 0;
out = out.slice(0, at) + (lastImport ? importLine : importLine.trimStart() + '\n') + out.slice(at);

const stateSrc = [
  `// Shared mutable application state, moved out of ${basename(srcPath)} by`,
  `// tools/state-codemod.mjs. Read these bindings directly (imports are live);`,
  `// write them only through the setters (imported bindings are read-only).`,
  '',
  ...decls.map(({ name, decl }) => {
    const init = decl.init ? src.slice(decl.init.start, decl.init.end) : undefined;
    const lines = [`export let ${name}${init !== undefined ? '=' + init : ''};`, `export function ${setterName(name)}(v){return ${name}=v}`];
    if (helpers.get(name).has('inc')) lines.push(`export function ${incName(name)}(prefix){return prefix?++${name}:${name}++}`);
    if (helpers.get(name).has('dec')) lines.push(`export function ${decName(name)}(prefix){return prefix?--${name}:${name}--}`);
    return lines.join('\n');
  }),
  '',
].join('\n');

writeFileSync(statePath, stateSrc);
writeFileSync(srcPath, out);
const n = { assign: sites.filter(s => s.kind === 'assign').length, update: sites.filter(s => s.kind === 'update').length };
console.log(`moved ${moved.size} bindings -> ${statePath}; rewrote ${n.assign} assignments and ${n.update} updates`);
