import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The refactoring tools are the safety net for splitting docs/app.js, so they
// get their own tests.
const run = (src, names) => {
  const dir = mkdtempSync(join(tmpdir(), 'vrl-extract-'));
  const file = join(dir, 'app.js'), out = join(dir, 'mod.js');
  writeFileSync(file, src);
  let code = 0, stderr = '';
  try { execFileSync(process.execPath, ['tools/extract-module.mjs', file, out, ...names], { stdio: 'pipe' }); }
  catch (e) { code = e.status; stderr = String(e.stderr); }
  return { code, stderr, app: readFileSync(file, 'utf8'), mod: existsSync(out) ? readFileSync(out, 'utf8') : null };
};

describe('tools/extract-module.mjs', () => {
  it('moves a self-contained function and imports it back', () => {
    const r = run("import x from 'https://cdn/x.js';\nfunction pure(a){return x(a)*2}\npure(1);\n", ['pure']);
    expect(r.code).toBe(0);
    expect(r.mod).toContain('export function pure(a){return x(a)*2}');
    expect(r.mod).toContain("import x from 'https://cdn/x.js';");
    expect(r.app).toContain("import { pure } from './mod.js';");
    expect(r.app).not.toContain('function pure');
  });

  it('works when the source has no imports', () => {
    const r = run('function pure(a){return a*2}\npure(1);\n', ['pure']);
    expect(r.code).toBe(0);
    expect(r.app.startsWith("import { pure } from './mod.js';")).toBe(true);
  });

  it('aborts when moved code READS a let that stays behind', () => {
    const r = run('let n=0;\nfunction get(){return n}\n', ['get']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/n\s+<- used by get/);
  });

  // Regression: acorn-walk reports assignment targets as VariablePattern, which
  // the filtering pass once ignored, letting write-only state slip through.
  it('aborts when moved code only WRITES a let that stays behind', () => {
    const r = run('let counter=0;\nfunction bump(){counter=counter+1}\nfunction reset(){counter=0}\n', ['reset']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/counter\s+<- used by reset/);
    expect(r.mod).toBeNull();
  });

  it('refuses to move let declarations and reassigned names', () => {
    expect(run('let s=1;\n', ['s']).code).toBe(1);
  });

  it('ignores property names that merely match a top-level name', () => {
    const r = run('let size=0;\nfunction area(o){return o.size*2}\nsize++;\n', ['area']);
    expect(r.code).toBe(0);
  });
});

describe('tools/extract-module.mjs @line:N statements', () => {
  it('moves a leading side-effect statement together with its declarations', () => {
    const r = run("import x from 'https://cdn/x.js';\nconst app=document.body;\napp.innerHTML=`<p>${x}</p>`;\nconst el=app.firstChild;\nel.remove();\n", ['app', '@line:3', 'el']);
    expect(r.code).toBe(0);
    expect(r.mod).toMatch(/export const app=document\.body;\napp\.innerHTML=`<p>\$\{x\}<\/p>`;\nexport const el=app\.firstChild;/);
    expect(r.app).not.toContain('innerHTML');
    expect(r.app).toContain('el.remove();');
  });

  it('refuses to move a statement that has earlier side effects before it', () => {
    const r = run('const app=document.body;\nconsole.log(1);\napp.innerHTML="x";\n', ['app', '@line:3']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/side-effect statement precedes/);
  });

  it('refuses when the statement depends on something that stays', () => {
    const r = run('let n=1;\nconst app=document.body;\napp.textContent=n;\n', ['app', '@line:3']);
    expect(r.code).toBe(1);
  });
});

describe('tools/extract-module.mjs --append', () => {
  it('appends to an existing module and extends the existing import', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrl-append-'));
    const file = join(dir, 'app.js'), mod = join(dir, 'mod.js');
    writeFileSync(mod, "// header\nimport y from 'https://cdn/y.js';\nexport function a(){return y()}\n");
    writeFileSync(file, "import y from 'https://cdn/y.js';\nimport { a } from './mod.js?v=1-build2';\nfunction b(){return a()+y()}\nb();\n");
    execFileSync(process.execPath, ['tools/extract-module.mjs', '--append', file, mod, 'b'], { stdio: 'pipe' });
    const m = readFileSync(mod, 'utf8'), s = readFileSync(file, 'utf8');
    expect(m).toContain('export function b(){return a()+y()}');
    expect(m.match(/import y from/g)).toHaveLength(1);      // not duplicated
    expect(m).not.toContain("from './mod.js");               // no self-import
    expect(s).toContain("import { a, b } from './mod.js?v=1-build2';");
    expect(s).not.toContain('function b');
  });

  it('refuses to overwrite without --append', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrl-append-'));
    writeFileSync(join(dir, 'mod.js'), 'export const z=1;\n');
    writeFileSync(join(dir, 'app.js'), 'function b(){return 1}\n');
    let code = 0; try { execFileSync(process.execPath, ['tools/extract-module.mjs', join(dir, 'app.js'), join(dir, 'mod.js'), 'b'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
    expect(code).toBe(2);
  });
});
