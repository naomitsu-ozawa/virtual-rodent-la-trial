import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const TOOLS = resolve('tools');
const SAMPLE = `import x from 'https://cdn/x.js';
let a=0,b=null,keepMe=compute();
let list=[],n=1;
function compute(){return 1}
function f(v){a=v;b=a=v+1;a+=2;b??=v;b||=5;a++;++a;n--;return list.length}
function shadow(a){a=5;let n=2;n++;return a+n}
function g(){const r=a++;return (a=3)+r}
a=x(a);
`;

function setup(src = SAMPLE) {
  const dir = mkdtempSync(join(tmpdir(), 'vrl-state-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.js'), src); git('add', 'a.js'); git('commit', '-qm', 'base');
  const node = (tool, ...args) => {
    try { return { code: 0, out: String(execFileSync(process.execPath, [join(TOOLS, tool), ...args], { cwd: dir, stdio: 'pipe' })) }; }
    catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
  };
  return { dir, node, read: f => readFileSync(join(dir, f), 'utf8'), write: (f, s) => writeFileSync(join(dir, f), s) };
}

describe('tools/state-codemod.mjs + verify-state-codemod.mjs', () => {
  it('rewrites writes, leaves shadowed locals alone, and verifies', () => {
    const t = setup();
    expect(t.node('state-codemod.mjs', 'a.js', 's.js').code).toBe(0);
    const a = t.read('a.js');
    expect(a).toContain('setB(setA(v+1))');
    expect(a).toContain('setA(a+(2))');
    expect(a).toContain('(b??setB(v))');
    expect(a).toContain('incA(false);incA(true);decN(false)');
    expect(a).toContain('function shadow(a){a=5;let n=2;n++;return a+n}');
    expect(a).toContain('let keepMe=compute();');
    expect(t.read('s.js')).toContain('export function incA(prefix){return prefix?++a:a++}');
    const v = t.node('verify-state-codemod.mjs', 'HEAD', 'a.js', 'a.js', 's.js');
    expect(v.out).toMatch(/^OK: 4 bindings moved; 12 write sites/m);
  });

  it('generated helpers preserve assignment/update expression values', async () => {
    const t = setup();
    t.node('state-codemod.mjs', 'a.js', 's.js');
    const s = await import(join(t.dir, 's.js'));
    expect(s.setA(7)).toBe(7);
    expect(s.incA(false)).toBe(7); // postfix returns old value
    expect(s.a).toBe(8);
    expect(s.incA(true)).toBe(9);  // prefix returns new value
    expect(s.decN(false)).toBe(1);
    expect(s.n).toBe(0);
  });

  it.each([
    ['changed value', f => f.replace('setA(a+(2))', 'setA(a+(3))')],
    ['rewrote a shadowed local', f => f.replace('function shadow(a){a=5;', 'function shadow(a){setA(5);')],
    ['swapped prefix/postfix', f => f.replace('incA(true)', 'incA(false)')],
  ])('verifier rejects tampering: %s', (_name, tamper) => {
    const t = setup();
    t.node('state-codemod.mjs', 'a.js', 's.js');
    t.write('a.js', tamper(t.read('a.js')));
    expect(t.node('verify-state-codemod.mjs', 'HEAD', 'a.js', 'a.js', 's.js').code).toBe(1);
  });

  it('verifier rejects non-canonical setters', () => {
    const t = setup();
    t.node('state-codemod.mjs', 'a.js', 's.js');
    t.write('s.js', t.read('s.js').replace('{return b=v}', '{console.log(v);return b=v}'));
    expect(t.node('verify-state-codemod.mjs', 'HEAD', 'a.js', 'a.js', 's.js').code).toBe(1);
  });

  it('aborts on unsupported write forms (destructuring)', () => {
    const t = setup('let a=0,b=0;\nfunction f(o){[a,b]=o}\n');
    const r = t.node('state-codemod.mjs', 'a.js', 's.js');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/unsupported write/);
  });
});
