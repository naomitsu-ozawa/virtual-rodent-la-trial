// After moving exported declarations from one module to another (with
// extract-module.mjs), point every other docs/*.js import of those names at
// the new module. Only import lists change; code is untouched.
//
//   node tools/retarget-imports.mjs <from.js> <to.js> name [name...]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

const [fromPath, toPath, ...names] = process.argv.slice(2);
if (!fromPath || !toPath || !names.length) { console.error('usage: retarget-imports.mjs <from.js> <to.js> name...'); process.exit(2); }
const from = basename(fromPath), to = basename(toPath), moved = new Set(names);
const importRe = mod => new RegExp(`import \\{([^}]*)\\} from '\\./${mod.replace('.', '\\.')}(\\?v=[^']*)';\\n?`);
let changed = 0;
for (const f of readdirSync('docs').filter(f => f.endsWith('.js') && f !== from && f !== to)) {
  const p = `docs/${f}`; let s = readFileSync(p, 'utf8');
  const m = s.match(importRe(from)); if (!m) continue;
  const list = m[1].split(',').map(x => x.trim()).filter(Boolean), take = list.filter(n => moved.has(n.split(/\s+as\s+/)[0]));
  if (!take.length) continue;
  const keep = list.filter(n => !take.includes(n)), tag = m[2];
  s = s.replace(m[0], keep.length ? `import { ${keep.join(', ')} } from './${from}${tag}';\n` : '');
  const t = s.match(importRe(to));
  if (t) { const cur = t[1].split(',').map(x => x.trim()).filter(Boolean); s = s.replace(t[0], `import { ${[...new Set([...cur, ...take])].join(', ')} } from './${to}${t[2]}';\n`); }
  else { const at = s.search(/^import /m); const line = `import { ${take.join(', ')} } from './${to}${tag}';\n`; s = at >= 0 ? s.slice(0, at) + line + s.slice(at) : line + s; }
  writeFileSync(p, s); changed++; console.log('retargeted', p, take.join(','));
}
console.log(`${changed} file(s) updated`);
