// Move a self-contained set of top-level declarations from one ES module into
// a new module, verbatim, and replace them with an import.
//
//   node tools/extract-module.mjs [--append] <src.js> <module.js> <name|@line:N> [...]
//
// --append adds to an existing module: its imports are merged, and the
// existing import of that module in <src> is extended instead of duplicated.
//
// `@line:N` selects the top-level expression statement starting on line N of
// <src> (e.g. `app.innerHTML=...`). It is moved verbatim without `export` and
// runs when the new module is evaluated, i.e. before <src>'s own body — only
// use it for statements with no ordering dependency on earlier side effects
// of <src> (the tool refuses if any side-effect statement precedes it).
//
// Safety rules (the tool aborts instead of guessing):
// - Every top-level name referenced by a moved declaration must itself be
//   moved, or be an import binding (re-imported from the same source).
//   This guarantees the new module never imports back from <src>, so there
//   are no import cycles and no evaluation-order changes.
// - `let` / `var` declarations are never moved (shared mutable state).
// - Moved names must not be reassigned anywhere in <src>.
// - Consts with non-primitive initialisers are listed for human review.
//
// Code is moved byte-for-byte (only `export ` is prepended), so behavior is
// unchanged. Written for the docs/app.js split.
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const APPEND = argv.includes('--append');
const [srcPath, outPath, ...names] = argv.filter(a => a !== '--append');
if (!srcPath || !outPath || !names.length) {
  console.error('usage: extract-module.mjs <src.js> <new-module.js> <name> [name...]');
  process.exit(2);
}
if (existsSync(outPath) && !APPEND) { console.error(`refusing to overwrite ${outPath} (use --append to add to an existing module)`); process.exit(2); }
if (APPEND && !existsSync(outPath)) { console.error(`--append: ${outPath} does not exist`); process.exit(2); }

const src = readFileSync(srcPath, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
const lineOfPos = pos => src.slice(0, pos).split('\n').length;
const stmtLines = names.filter(n => n.startsWith('@line:')).map(n => Number(n.slice(6)));
const want = new Set(names.filter(n => !n.startsWith('@line:')));

const imports = new Map(); // local binding -> ImportDeclaration node
const top = new Map();     // name -> { kind, stmt, decl? }
for (const n of ast.body) {
  if (n.type === 'ImportDeclaration') for (const s of n.specifiers) imports.set(s.local.name, n);
  else if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') top.set(n.id.name, { kind: n.type, stmt: n });
  else if (n.type === 'VariableDeclaration') for (const d of n.declarations) {
    if (d.id.type !== 'Identifier') continue; // destructuring never moved
    top.set(d.id.name, { kind: n.kind, stmt: n, decl: d });
  } else if (n.type.startsWith('Export')) { console.error('source already has exports; not supported'); process.exit(2); }
}

const fail = msg => { console.error('ABORT: ' + msg); process.exit(1); };
const stmtTargets = stmtLines.map(L => {
  const st = ast.body.find(n => lineOfPos(n.start) === L && n.type === 'ExpressionStatement');
  if (!st) fail(`no top-level expression statement starts on line ${L}`);
  const earlier = ast.body.find(n => n.start < st.start && !/Declaration$/.test(n.type) && n.type !== 'EmptyStatement' && !stmtLines.includes(lineOfPos(n.start)));
  if (earlier) fail(`line ${L}: a side-effect statement precedes it (line ${lineOfPos(earlier.start)}); moving it would change execution order`);
  return st;
});
for (const n of want) {
  if (!top.has(n)) fail(`${n} is not a movable top-level declaration`);
  if (top.get(n).kind === 'let' || top.get(n).kind === 'var') fail(`${n} is ${top.get(n).kind} (mutable state)`);
}

// reassignment check
const reassigned = new Set();
walk.full(ast, node => {
  if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') reassigned.add(node.left.name);
  if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') reassigned.add(node.argument.name);
});
for (const n of want) if (reassigned.has(n)) fail(`${n} is reassigned in ${srcPath}`);

// dependency closure check
const neededImports = new Map(); // source -> Set(specifier text)
const missing = new Map();
const units = [...[...want].map(n => ({ n, node: top.get(n).decl || top.get(n).stmt })), ...stmtTargets.map(st => ({ n: `@line:${lineOfPos(st.start)}`, node: st }))];
for (const { n, node: unit } of units) {
  walk.full(unit, node => {
    if (node.type !== 'Identifier' || node.name === n) return;
    if (top.has(node.name) && !want.has(node.name)) {
      (missing.get(node.name) || missing.set(node.name, new Set()).get(node.name)).add(n);
    } else if (imports.has(node.name) && !top.has(node.name)) {
      const imp = imports.get(node.name);
      const spec = imp.specifiers.find(s => s.local.name === node.name);
      const text = spec.type === 'ImportDefaultSpecifier' ? `default as ${node.name}`
        : spec.type === 'ImportNamespaceSpecifier' ? `* as ${node.name}`
        : (spec.imported.name === node.name ? node.name : `${spec.imported.name} as ${node.name}`);
      const key = imp.source.value;
      (neededImports.get(key) || neededImports.set(key, new Set()).get(key)).add(text);
    }
  });
}
// Identifier walk also sees property keys / member names that merely share a
// name with a top-level decl (e.g. obj.fmt). Filter those false positives.
if (missing.size) {
  const real = new Map();
  for (const { n, node: unit } of units) {
    // NB: acorn-walk reports assignment targets / patterns as 'VariablePattern',
    // not 'Identifier' — both must be checked or writes to state are missed.
    const visit = (node, _st, anc) => {
        if (node.type !== 'Identifier' || !missing.has(node.name)) return;
        const parent = anc[anc.length - 2];
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return;
        if (parent?.type === 'MethodDefinition' && parent.key === node) return;
        if (parent?.type === 'PropertyDefinition' && parent.key === node) return;
        (real.get(node.name) || real.set(node.name, new Set()).get(node.name)).add(n);
    };
    walk.ancestor(unit, { Identifier: visit, VariablePattern: visit });
  }
  if (real.size) fail('moved code depends on declarations that would stay behind:\n' +
    [...real].map(([dep, users]) => `  ${dep}  <- used by ${[...users].join(', ')}  (${top.get(dep).kind})`).join('\n'));
}

// review list: consts whose initialiser is not a primitive/function
const review = [];
for (const n of want) {
  const { kind, decl } = top.get(n);
  if (kind !== 'const') continue;
  const t = decl.init?.type;
  if (!['Literal', 'ArrowFunctionExpression', 'FunctionExpression', 'TemplateLiteral', 'BinaryExpression', 'UnaryExpression'].includes(t)) review.push(`${n} (${t})`);
}

// build edits
const edits = []; // {start,end,text}
const moved = [];
const byStmt = new Map();
for (const n of want) { const e = top.get(n); (byStmt.get(e.stmt) || byStmt.set(e.stmt, []).get(e.stmt)).push(e); }
for (const [stmt, entries] of [...byStmt].sort((a, b) => a[0].start - b[0].start)) {
  if (stmt.type !== 'VariableDeclaration' || entries.length === stmt.declarations.length) {
    moved.push({ pos: stmt.start, text: 'export ' + src.slice(stmt.start, stmt.end) });
    edits.push({ start: stmt.start, end: stmt.end, text: '' });
  } else {
    const movedDecls = new Set(entries.map(e => e.decl));
    for (const d of stmt.declarations) if (movedDecls.has(d)) moved.push({ pos: d.start, text: `export ${stmt.kind} ${src.slice(d.start, d.end)};` });
    const keep = stmt.declarations.filter(d => !movedDecls.has(d)).map(d => src.slice(d.start, d.end));
    const tail = src.slice(stmt.declarations.at(-1).end, stmt.end); // usually ';' or ''
    edits.push({ start: stmt.start, end: stmt.end, text: `${stmt.kind} ${keep.join(',')}${tail}` });
  }
}
for (const st of stmtTargets) {
  moved.push({ pos: st.start, text: src.slice(st.start, st.end) });
  edits.push({ start: st.start, end: st.end, text: '' });
}
moved.sort((a, b) => a.pos - b.pos);

// import line in source, placed after the last import
const lastImport = ast.body.filter(n => n.type === 'ImportDeclaration').at(-1);
const tag = src.match(/\?v=([0-9]+-build[0-9.]+)/)?.[1];
const spec = './' + basename(outPath) + (tag ? `?v=${tag}` : '');
const existingImport = ast.body.find(n => n.type === 'ImportDeclaration' && n.source.value.replace(/\?.*$/, '') === './' + basename(outPath));
if (existingImport) {
  if (existingImport.specifiers.some(sp => sp.type !== 'ImportSpecifier')) fail('existing import of the module is not a plain named import');
  const all = new Set([...existingImport.specifiers.map(sp => sp.imported.name === sp.local.name ? sp.local.name : `${sp.imported.name} as ${sp.local.name}`), ...want]);
  edits.push({ start: existingImport.start, end: existingImport.end, text: `import { ${[...all].sort().join(', ')} } from '${existingImport.source.value}';` });
} else {
  const importLine = `\nimport { ${[...want].sort().join(', ')} } from '${spec}';`;
  const at = lastImport ? lastImport.end : 0;
  edits.push({ start: at, end: at, text: lastImport ? importLine : importLine.trimStart() + '\n' });
}

let out = src;
for (const e of edits.sort((a, b) => b.start - a.start)) {
  let { start, end } = e;
  // swallow the line break when a removal leaves an empty line
  if (e.text === '') {
    const before = out.lastIndexOf('\n', start - 1);
    const lineHead = out.slice(before + 1, start);
    if (/^\s*$/.test(lineHead) && out[end] === '\n') end += 1;
  }
  out = out.slice(0, start) + e.text + out.slice(end);
}

const header = [
  `// Extracted verbatim from ${basename(srcPath)} by tools/extract-module.mjs.`,
  `// Depends only on the imports below; never imports from ${basename(srcPath)} (no cycles).`,
  ...[...neededImports].map(([source, specs]) => {
    const list = [...specs];
    const def = list.find(s => s.startsWith('default as '));
    const ns = list.find(s => s.startsWith('* as '));
    const named = list.filter(s => s !== def && s !== ns);
    const parts = [def && def.slice(11), ns, named.length && `{ ${named.join(', ')} }`].filter(Boolean);
    return `import ${parts.join(', ')} from '${source}';`;
  }),
  '',
].join('\n');

if (APPEND) {
  const prev = readFileSync(outPath, 'utf8');
  const prevAst = acorn.parse(prev, { ecmaVersion: 'latest', sourceType: 'module' });
  const have = new Set(prevAst.body.filter(n => n.type === 'ImportDeclaration').flatMap(n => n.specifiers.map(sp => sp.local.name)));
  const declared = new Set(prevAst.body.flatMap(n => n.type === 'ExportNamedDeclaration' && n.declaration ? (n.declaration.id ? [n.declaration.id.name] : n.declaration.declarations.map(d => d.id.name)) : []));
  for (const n of want) if (declared.has(n) || have.has(n)) fail(`${n} already exists in ${outPath}`);
  const prevEdits = []; // merge named specifiers into an existing import of the same source
  const newImports = [...neededImports].map(([source, specs]) => {
    const list = [...specs].filter(sp => !have.has(sp.replace(/^.* as /, '').replace(/^default as /, '')));
    if (!list.length) return null;
    const same = prevAst.body.find(n => n.type === 'ImportDeclaration' && n.source.value === source && n.specifiers.length && n.specifiers.every(x => x.type === 'ImportSpecifier'));
    if (same && list.every(x => !x.startsWith('default as ') && !x.startsWith('* as '))) {
      const names = [...same.specifiers.map(x => x.imported.name === x.local.name ? x.local.name : `${x.imported.name} as ${x.local.name}`), ...list];
      prevEdits.push({ start: same.start, end: same.end, text: `import { ${names.join(', ')} } from '${source}';` });
      return null;
    }
    const def = list.find(x => x.startsWith('default as ')), ns = list.find(x => x.startsWith('* as ')), named = list.filter(x => x !== def && x !== ns);
    const parts = [def && def.slice(11), ns, named.length && `{ ${named.join(', ')} }`].filter(Boolean);
    return `import ${parts.join(', ')} from '${source}';`;
  }).filter(Boolean);
  // module self-imports make no sense (e.g. moving tr into i18n.js that tr uses)
  const self = './' + basename(outPath);
  const kept = newImports.filter(l => !l.includes(`'${self}`));
  const lastPrevImport = prevAst.body.filter(n => n.type === 'ImportDeclaration').at(-1);
  const insertAt = lastPrevImport ? lastPrevImport.end : prev.indexOf('\n', prev.lastIndexOf('// ', 200)) + 1;
  let base = prev;
  for (const e of prevEdits.sort((a, b) => b.start - a.start)) base = base.slice(0, e.start) + e.text + base.slice(e.end);
  const shift = prevEdits.filter(e => e.start < insertAt).reduce((d, e) => d + e.text.length - (e.end - e.start), 0);
  const merged = base.slice(0, insertAt + shift) + (kept.length ? (lastPrevImport ? '\n' : '') + kept.join('\n') + (lastPrevImport ? '' : '\n') : '') + base.slice(insertAt + shift);
  writeFileSync(outPath, merged.replace(/\n*$/, '\n') + moved.map(m => m.text).join('\n') + '\n');
} else writeFileSync(outPath, header + moved.map(m => m.text).join('\n') + '\n');
writeFileSync(srcPath, out);
console.log(`moved ${want.size} declarations${stmtTargets.length ? ` + ${stmtTargets.length} statement(s)` : ''} -> ${outPath}`);
if (neededImports.size) console.log('re-imported:', [...neededImports].map(([s, v]) => `${s} {${[...v].join(', ')}}`).join('; '));
if (review.length) console.log('REVIEW (non-primitive consts: moved as the same shared object; check the initialiser has no side effects):', review.join(', '));
