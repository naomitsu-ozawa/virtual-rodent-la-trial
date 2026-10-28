import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'acorn';
import { full } from 'acorn-walk';
import { SAMPLE_SETS, sampleIndexUrl, sampleSliceUrl, sampleProjectUrl, sampleCacheKey, sampleSet } from '../../docs/sample-sets.js';

// The practice data is the only data the app loads. Every network target of the loading path comes from the fixed
// SAMPLE_SETS table (docs/sample-sets.js): an id that is not in the table throws, and a file name from an index.json can
// only be appended to the table's folder.

const SITE = 'https://site.example/app/';
const readDocs = f => readFileSync(new URL(`../../docs/${f}`, import.meta.url), 'utf8');

// loadSampleDemo, taken from the source of docs/data-load.js (that module needs a DOM) and run against recording stubs
function loadSampleDemoFromSource() {
  const src = readDocs('data-load.js');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const decl = ast.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration' && n.declaration.id.name === 'loadSampleDemo');
  expect(decl, 'export async function loadSampleDemo exists').toBeTruthy();
  const fnSrc = src.slice(decl.declaration.start, decl.declaration.end);
  const factory = new Function('deps', `const {${Object.keys(depsTemplate()).join(',')}}=deps;return (${fnSrc});`);
  return { fnSrc, run: async (setId, indexFiles, { hasCache = false } = {}) => {
    const fetched = [], deps = depsTemplate(fetched, indexFiles, hasCache);
    const fn = factory(deps);
    const result = await (setId === undefined ? fn() : fn(setId));
    return { fetched, result };
  } };
}
function depsTemplate(fetched = [], indexFiles = ['a.dcm'], hasCache = false) {
  const cache = { match: async () => null, put: async () => {} };
  return {
    loadStat: () => {}, loadStatTime: () => {}, loadPhase: () => {}, progLabel: {}, bar: { style: {} }, footer: {}, progress: () => {}, tr: k => k, fmt: n => String(n),
    DEFAULT_SAMPLE: 'sample1', SAMPLE_CACHE: 'cache', withTimeout: p => Promise.resolve(p),
    sampleIndexUrl, sampleSliceUrl, sampleCacheKey,
    location: new URL(SITE + 'index.html'),
    window: hasCache ? { caches: {} } : {},
    caches: { open: async () => cache },
    fetch: async (url, opts) => {
      fetched.push({ url: String(url), opts });
      const body = String(url).endsWith('index.json') ? JSON.stringify({ files: indexFiles }) : 'x';
      return new Response(body, { status: 200 });
    },
  };
}

describe('practice-data fetch targets come from the SAMPLE_SETS table only', () => {
  const ids = Object.keys(SAMPLE_SETS);

  it('the table is the four bundled sets, each below its own demo/ folder', () => {
    expect(ids).toEqual(['sample1', 'sample2', 'sample3', 'sample4']);
    for (const id of ids) expect(SAMPLE_SETS[id].base).toBe(`demo/${id}/`);
  });

  it.each(ids)('loadSampleDemo(%s) fetches the index and the slices of that set and nothing else', async id => {
    const names = ['s 1.dcm', 's2.dcm', 'ünï.dcm'];
    const { run } = loadSampleDemoFromSource();
    const { fetched, result } = await run(id, names);
    // the index first, then the slices (in any order)
    const targets = fetched.map(f => new URL(f.url, SITE).href);
    for (const t of targets) expect(t.startsWith(`${SITE}demo/${id}/`)).toBe(true);
    expect(targets[0]).toBe(`${SITE}demo/${id}/index.json`);
    expect(targets.slice(1).sort()).toEqual(names.map(n => new URL(sampleSliceUrl(id, n), SITE).href).sort());
    expect(fetched.every(f => f.opts.credentials === 'omit')).toBe(true);
    expect(result).toHaveLength(names.length);
  });

  it('the default set is sample1 when no id is given', async () => {
    const { run } = loadSampleDemoFromSource();
    const { fetched } = await run(undefined, ['a.dcm']);
    expect(new URL(fetched[0].url, SITE).href).toBe(`${SITE}demo/sample1/index.json`);
  });

  it('a hostile index.json cannot move a slice fetch out of the set folder (names are encoded as one path segment)', async () => {
    const names = ['https://evil.example/x.dcm', '//evil.example/x.dcm', '../../other.dcm', '/abs/x.dcm', 'a/b.dcm', 'x.dcm?u=1#h'];
    const { run } = loadSampleDemoFromSource();
    const { fetched } = await run('sample2', names);
    expect(fetched).toHaveLength(names.length + 1);
    for (const f of fetched) {
      const u = new URL(f.url, SITE);
      expect(u.origin).toBe('https://site.example');
      expect(u.href.startsWith(`${SITE}demo/sample2/`)).toBe(true);
      expect(u.search).toBe('');
      expect(u.hash).toBe('');
    }
  });

  const UNKNOWN = ['sample0', 'sample5', 'sample10', 'Sample1', ' sample1', 'sample1 ', '', '../sample1', 'sample1/..', 'sample1/', 'https://evil.example/', '//evil.example/', null, 0, 1, {}];
  it.each(UNKNOWN.map(v => [JSON.stringify(v) ?? String(v), v]))('an unknown set id (%s) throws and fetches nothing', async (_label, id) => {
    const { run } = loadSampleDemoFromSource();
    const calls = [];
    await expect(run(id, ['a.dcm']).then(r => { calls.push(...r.fetched); return r; })).rejects.toThrow(/Unknown sample set/);
    expect(calls).toEqual([]);
  });
  it.each(UNKNOWN.map(v => [JSON.stringify(v) ?? String(v), v]))('the URL helpers refuse an unknown id (%s)', (_label, id) => {
    expect(() => sampleIndexUrl(id)).toThrow(/Unknown sample set/);
    expect(() => sampleSliceUrl(id, 'a.dcm')).toThrow(/Unknown sample set/);
    expect(() => sampleProjectUrl(id)).toThrow(/Unknown sample set/);
    expect(() => sampleCacheKey('https://x.io', id, 'a.dcm')).toThrow(/Unknown sample set/);
    expect(sampleSet(id)).toBeNull();
  });
  // Object.prototype names are not own keys of the table, so they are refused like any unknown id.
  it('names of Object.prototype members are refused too', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(() => sampleIndexUrl(id)).toThrow(/Unknown sample set/);
  });

  it('static: loadSampleDemo calls fetch only with sampleIndexUrl(setId) and a url built by sampleSliceUrl(setId, name)', () => {
    const { fnSrc } = loadSampleDemoFromSource();
    const ast = parse(`(${fnSrc})`, { ecmaVersion: 'latest' });
    const args = [], urlInits = [];
    full(ast, n => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'fetch') args.push(`(${fnSrc})`.slice(n.arguments[0].start, n.arguments[0].end));
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'url') urlInits.push(`(${fnSrc})`.slice(n.init.start, n.init.end));
    });
    expect(args.sort()).toEqual(['sampleIndexUrl(setId)', 'url']);
    expect(urlInits).toHaveLength(1);
    expect(urlInits[0]).toMatch(/^new URL\(sampleSliceUrl\(setId,names\[i\]\),location\.href\)\.href$/);
  });

  it('static: loadSampleDemo has no other caller than app.js startSample, and startSample is fed a table id or a sampleN id only', () => {
    const callers = [];
    for (const f of readdirSync(new URL('../../docs/', import.meta.url)).filter(n => n.endsWith('.js'))) {
      const src = readDocs(f);
      for (const m of src.matchAll(/\bloadSampleDemo\s*\(/g)) callers.push(f + (f === 'data-load.js' && src.slice(m.index - 22, m.index).includes('function') ? ' (definition)' : ''));
    }
    expect(callers.sort()).toEqual(['app.js', 'data-load.js (definition)']);
    const app = readDocs('app.js');
    expect(app).toMatch(/const startSample=async setId=>\{[^]*?await loadSampleDemo\(setId\)/);
    // the event path hands over only `sample<digits>`; the chooser buttons pass their data-sample-set
    expect(app).toMatch(/typeof id==='string'&&\/\^sample\\d\+\$\/\.test\(id\)/);
  });

  it('static: every fetch( in docs/ targets a table-built URL, the version file, or a worker-local function', () => {
    const found = [];
    for (const f of readdirSync(new URL('../../docs/', import.meta.url)).filter(n => n.endsWith('.js'))) {
      const src = readDocs(f);
      const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
      full(ast, n => {
        if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'fetch') found.push(`${f}: ${src.slice(n.arguments[0].start, n.arguments[0].end)}`);
      });
    }
    expect(found.sort()).toEqual([
      "app.js: './version.json?t='+Date.now()",
      'app.js: sampleProjectUrl(setId)',
      'data-load.js: sampleIndexUrl(setId)',
      'data-load.js: url',
      'source-filters.js: k', // a local slice-prefetch function named fetch, not window.fetch
    ].sort());
  });
});
