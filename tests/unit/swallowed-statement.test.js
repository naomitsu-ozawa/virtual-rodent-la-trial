import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { lineComments, swallowedStatement } from '../helpers/line-comments.js';

// Build 474 regression (see vr-view-laser-dot.test.js): an edit put "scene.add(dot);c.userData.dot=dot;" after a // comment on the same line, so the
// statements never ran and VR/AR showed nothing. This guard scans every docs/*.js for the same accident anywhere (builds 436 and 481 had it too, unnoticed).

// Known live defects on main, found when this guard was written. App behaviour was deliberately not changed in that PR, so they are listed here.
// FIX = move the swallowed statement onto its own line (that changes the app: bump the build), then DELETE the entry (a stale entry fails the test below).
const KNOWN = [
];

const files = readdirSync('docs').filter(f => f.endsWith('.js'));
const found = f => lineComments(readFileSync('docs/' + f, 'utf8')).map(c => ({ ...c, why: swallowedStatement(c) })).filter(c => c.why);

describe('swallowedStatement (the detector)', () => {
  const run = (src) => lineComments(src).map(swallowedStatement).filter(Boolean);
  it('flags the build 474 shape', () => {
    expect(run('foo();// laser end dot, hide it themscene.add(dot);c.userData.dot=dot;')).toHaveLength(1);
    expect(run('// full-line comment themscene.add(dot);')).toHaveLength(1);
  });
  it('flags a statement glued after a comment end (builds 436 / 481)', () => {
    expect(run('a=1; // (was the window centre)sigmoidCenter.disabled=!filterState.sigmoid;')).toHaveLength(1);
    expect(run('x(); // no DOM rebuild per moveonMeasureStartChange(()=>{syncPulse()});')).toHaveLength(1);
    expect(run('x(); // note;y.z=1')).toHaveLength(1);
  });
  it('flags GLSL line comments inside a template literal too', () => {
    expect(run('const s=`\nfloat a=1.0; // note;b=2.0;\n`;')).toHaveLength(1);
  });
  it('does not flag prose, URLs in strings, regex ends or block comments', () => {
    expect(run("const u='https://example.org/a//b';const v=\"//x;\";")).toEqual([]);
    expect(run('const u=`https://example.org/x`;')).toEqual([]);
    expect(run('const r=s.replace(/https?:\\/\\//,\'\');')).toEqual([]);
    expect(run('/* a // b;c=1; */ const x=1;')).toEqual([]);
    expect(run('// one; two (see foo.bar(x)); three')).toEqual([]);
    expect(run('// a full-line comment may end with a semicolon;')).toEqual([]);
    expect(run('foo(); // explanation, then foo.bar(baz) is called')).toEqual([]);
    expect(run('foo(); // a; b.c(d)')).toEqual([]);
  });
});

describe('docs/*.js: no line comment swallows a statement', () => {
  it.each(files)('%s', f => {
    const hits = found(f).filter(c => !KNOWN.some(k => k.file === f && c.text.includes(k.has)));
    expect(hits.map(c => `${f}:${c.line} ${c.why}: ${c.text.trim().slice(0, 140)}`)).toEqual([]);
  });
  it('the known defects are still there (delete the KNOWN entry when one is fixed)', () => {
    for (const k of KNOWN) expect(found(k.file).some(c => c.text.includes(k.has)), `${k.file} (${k.since}) no longer has the swallowed statement: remove it from KNOWN`).toBe(true);
  });
});
