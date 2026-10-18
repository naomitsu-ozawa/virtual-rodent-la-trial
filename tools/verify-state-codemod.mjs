// Prove that tools/state-codemod.mjs only did what it claims.
//
//   node tools/verify-state-codemod.mjs <git-rev> <orig-path> <new-src.js> <state.js>
//
// Walks the ORIGINAL and the NEW syntax trees in parallel. Everywhere except
// writes to moved bindings the trees must be identical (ignoring source
// positions and parentheses). At each write site of the original (found with
// eslint-scope, so shadowing locals are excluded) the new tree must contain
// exactly the rewrite prescribed by the codemod. The state module must declare
// each moved binding with the original initialiser and the canonical helpers.
import * as acorn from 'acorn';
import { analyze } from 'eslint-scope';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [rev, origPath, newPath, statePath] = process.argv.slice(2);
const parse = s => acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
const oldSrc = execFileSync('git', ['show', `${rev}:${origPath}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
const oldAst = parse(oldSrc), newAst = parse(readFileSync(newPath, 'utf8'));
const stateSrc = readFileSync(statePath, 'utf8'), stateAst = parse(stateSrc);
const cap = n => n[0].toUpperCase() + n.slice(1);
const errors = [];
const err = (m, node) => { errors.push(m + (node ? ` (orig line ${oldSrc.slice(0, node.start).split('\n').length})` : '')); };

// moved bindings = `export let` in the state module
const moved = new Map();
for (const s of stateAst.body) if (s.type === 'ExportNamedDeclaration' && s.declaration?.type === 'VariableDeclaration') for (const d of s.declaration.declarations) moved.set(d.id.name, d);

// write sites in the original
const scopes = analyze(oldAst, { ecmaVersion: 2022, sourceType: 'module' });
const mod = scopes.globalScope.childScopes.find(s => s.type === 'module');
const parents = new Map();
(function link(n, p) { if (!n || typeof n.type !== 'string') return; parents.set(n, p); for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(c => c && link(c, n)); else if (v && typeof v.type === 'string') link(v, n); } })(oldAst, null);
const sites = new Map(); // node -> name
const oldDecls = new Map();
for (const [name] of moved) {
  const v = mod.set.get(name);
  if (!v) { err(`${name} is not a module-scope binding of the original`); continue; }
  for (const ref of v.references) if (ref.isWrite() && !ref.init) sites.set(parents.get(ref.identifier), name);
  const def = v.defs[0];
  if (def?.node?.type !== 'VariableDeclarator' || def.parent.kind === 'const') err(`${name} was not a let/var in the original`);
  else oldDecls.set(name, def.node);
}

const SKIP = new Set(['start', 'end', 'range', 'loc']);
function same(a, b, path) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') { err(`mismatch at ${path}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`); return false; }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) { err(`array length mismatch at ${path}`); return false; }
    return a.every((x, i) => same(x, b[i], `${path}[${i}]`));
  }
  if (sites.has(a)) return rewritten(a, b, sites.get(a), path);
  if (a.type !== b.type) { err(`node type ${a.type} -> ${b.type} at ${path}`, a); return false; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!SKIP.has(k) && !same(a[k], b[k], `${path}.${k}`)) return false;
  return true;
}
const isCall = (n, callee, argc) => n?.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === callee && n.arguments.length === argc;
function rewritten(a, b, name, path) {
  const set = 'set' + cap(name);
  if (a.type === 'UpdateExpression') {
    const h = (a.operator === '++' ? 'inc' : 'dec') + cap(name);
    if (isCall(b, h, 1) && b.arguments[0].type === 'Literal' && b.arguments[0].value === a.prefix) return true;
    err(`update of ${name} not rewritten as ${h}(${a.prefix}) at ${path}`, a); return false;
  }
  const op = a.operator;
  if (op === '=') {
    if (isCall(b, set, 1)) return same(a.right, b.arguments[0], `${path}<${set} arg>`);
  } else if (['||=', '&&=', '??='].includes(op)) {
    if (b.type === 'LogicalExpression' && b.operator === op.slice(0, -1) && b.left.type === 'Identifier' && b.left.name === name && isCall(b.right, set, 1)) return same(a.right, b.right.arguments[0], `${path}<${set} arg>`);
  } else {
    const arg = b.arguments?.[0];
    if (isCall(b, set, 1) && arg.type === 'BinaryExpression' && arg.operator === op.slice(0, -1) && arg.left.type === 'Identifier' && arg.left.name === name) return same(a.right, arg.right, `${path}<${set} arg>`);
  }
  err(`write ${name} ${op} not rewritten per rule at ${path}`, a); return false;
}

// program bodies: drop moved declarators (orig) and the state import (new)
const oldBody = [];
for (const s of oldAst.body) {
  if (s.type === 'VariableDeclaration' && s.kind !== 'const') {
    const keep = s.declarations.filter(d => !moved.has(d.id.name));
    if (keep.length) oldBody.push({ ...s, declarations: keep });
  } else oldBody.push(s);
}
const stateBase = basename(statePath);
const imp = newAst.body.find(s => s.type === 'ImportDeclaration' && s.source.value.replace(/\?.*$/, '') === './' + stateBase);
if (!imp) err(`new source does not import ./${stateBase}`);
const newBody = newAst.body.filter(s => s !== imp);
same(oldBody, newBody, 'Program.body');

// import list: exactly the bindings plus the helpers that exist in state.js
const exported = new Set(stateAst.body.filter(s => s.type === 'ExportNamedDeclaration').flatMap(s => s.declaration.type === 'FunctionDeclaration' ? [s.declaration.id.name] : s.declaration.declarations.map(d => d.id.name)));
const imported = new Set(imp?.specifiers.map(s => s.imported.name) || []);
for (const n of imported) if (!exported.has(n)) err(`imports ${n}, which state.js does not export`);
for (const n of exported) if (!imported.has(n)) err(`state.js exports ${n}, which is not imported`);

// state module: original initialisers + canonical helper bodies only
for (const [name, d] of moved) {
  const o = oldDecls.get(name);
  if (o) same(o.init, d.init, `init of ${name}`);
}
const canon = new Set();
for (const name of moved.keys()) {
  canon.add(`export function set${cap(name)}(v){return ${name}=v}`);
  canon.add(`export function inc${cap(name)}(prefix){return prefix?++${name}:${name}++}`);
  canon.add(`export function dec${cap(name)}(prefix){return prefix?--${name}:${name}--}`);
}
for (const s of stateAst.body) {
  if (s.type === 'ExportNamedDeclaration' && s.declaration?.type === 'FunctionDeclaration' && !canon.has(stateSrc.slice(s.start, s.end))) err(`non-canonical helper in state.js: ${stateSrc.slice(s.start, s.end).slice(0, 80)}`);
  else if (!(s.type === 'ExportNamedDeclaration' && s.declaration)) err(`unexpected statement in state.js: ${s.type}`);
}

if (errors.length) { console.log(errors.slice(0, 30).join('\n')); console.log(`FAILED: ${errors.length} problem(s)`); process.exit(1); }
console.log(`OK: ${moved.size} bindings moved; ${sites.size} write sites rewritten per rule; all other code identical`);
