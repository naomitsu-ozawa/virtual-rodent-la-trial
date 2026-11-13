import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'acorn';
import { full } from 'acorn-walk';
import { registry, defaultSampleId } from '../../docs/sample-registry.js';
import { listedIds } from '../helpers/demo-lists.js';
import { sampleIndexUrl, sampleSliceUrl, sampleProjectUrl, sampleCacheKey, sampleSet, sampleSliceFileName } from '../../docs/sample-sets.js';

// The practice data is the only data the app loads. Every network target of the loading path comes from the fixed
// registry (docs/sample-registry.js: the folders with a sample.json; docs/sample-sets.js builds each set by one rule): an id that is not registered throws, and a file name
// from an index.json can only be appended to the registered folder.

const SITE = 'https://site.example/app/';
const readDocs = f => readFileSync(new URL(`../../docs/${f}`, import.meta.url), 'utf8');

// loadSampleDemo, taken from the source of docs/data-load.js (that module needs a DOM) and run against recording stubs. It is written with two helpers of the same module
// (fetchSampleIndex, fetchSliceFiles: the loading with the set as an argument, shared with the partner loading); they are cut out the same way and run in the same scope.
const SAMPLE_LOAD_FUNCTIONS = ['fetchSampleIndex', 'fetchSliceFiles', 'loadSampleDemo'];
function loadSampleDemoFromSource() {
  const src = readDocs('data-load.js');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const declOf = name => {
    const n = ast.body.find(x => (x.type === 'FunctionDeclaration' && x.id.name === name) || (x.type === 'ExportNamedDeclaration' && x.declaration?.type === 'FunctionDeclaration' && x.declaration.id.name === name));
    expect(n, `async function ${name} exists`).toBeTruthy();
    const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
    return src.slice(d.start, d.end);
  };
  const fnSrc = declOf('loadSampleDemo');
  const helpers = SAMPLE_LOAD_FUNCTIONS.filter(n => n !== 'loadSampleDemo').map(declOf).join('\n');
  const factory = new Function('deps', `const {${Object.keys(depsTemplate()).join(',')}}=deps;${helpers}\nreturn (${fnSrc});`);
  return { fnSrc, run: async (setId, indexFiles, { hasCache = false, deps: extra = {} } = {}) => {
    const fetched = [], deps = { ...depsTemplate(fetched, indexFiles, hasCache), ...extra };
    const fn = factory(deps);
    const result = await (setId === undefined ? fn() : fn(setId));
    return { fetched, result };
  } };
}
function depsTemplate(fetched = [], indexFiles = ['a.dcm'], hasCache = false) {
  const cache = { match: async () => null, put: async () => {} };
  return {
    loadStat: () => {}, loadStatTime: () => {}, loadPhase: () => {}, progLabel: {}, bar: { style: {} }, footer: {}, progress: () => {}, tr: k => k, fmt: n => String(n),
    defaultSampleId, SAMPLE_CACHE: 'cache', withTimeout: p => Promise.resolve(p),
    sampleIndexUrl, sampleSliceUrl, sampleCacheKey, sampleSliceFileName,
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

describe('practice-data fetch targets come from the registered datasets only', () => {
  const ids = registry.samples.map(s => s.id).sort();

  it('the registry is the sets of docs/demo/samples.json, each below its own demo/ folder', () => {
    expect(ids).toEqual([...listedIds].sort());
    for (const id of ids) expect(sampleSet(id).base).toBe(`demo/${id}/`);
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
    const names = ['https://evil.example/x.dcm', '//evil.example/x.dcm', '../../other.dcm', '/abs/x.dcm', 'a/b/c.dcm', 'A/b.dcm', 'a//b.dcm', 'a\\b.dcm', 'x.dcm?u=1#h'];
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

  it('an index.json entry of the shape <sub-folder>/<file>.dcm is read from one sub-folder level of the set folder; the file keeps its own name', async () => {
    const names = ['ct/HindpawCT_0001.dcm', 'labels/HindpawLabels_0001.dcm', 'ct/s 2.DCM'];
    const { run } = loadSampleDemoFromSource();
    const { fetched, result } = await run('sample2', names);
    const targets = fetched.map(f => new URL(f.url, SITE).href);
    expect(targets[0]).toBe(`${SITE}demo/sample2/index.json`);
    expect(targets.slice(1).sort()).toEqual([`${SITE}demo/sample2/ct/HindpawCT_0001.dcm`, `${SITE}demo/sample2/ct/s%202.DCM`, `${SITE}demo/sample2/labels/HindpawLabels_0001.dcm`].sort());
    expect(result.map(f => f.name)).toEqual(['HindpawCT_0001.dcm', 'HindpawLabels_0001.dcm', 's 2.DCM']);
    expect(fetched.every(f => f.opts.credentials === 'omit')).toBe(true);
  });

  it('with a slice root, a sub-folder entry is read from <root>demo/<id>/<sub-folder>/ (only the slices; the index stays on the site)', async () => {
    const ROOT = 'https://raw.githubusercontent.com/o/r/main/docs/';
    const { run } = loadSampleDemoFromSource();
    const { fetched } = await run('sample3', ['ct/a.dcm'], { deps: { sampleSliceUrl: (id, n, p) => sampleSliceUrl(id, n, p, ROOT) } });
    expect(fetched.map(f => new URL(f.url, SITE).href)).toEqual([`${SITE}demo/sample3/index.json`, ROOT + 'demo/sample3/ct/a.dcm']);
  });

  it('flat names read exactly as before (same URL, same cache key, same File name)', async () => {
    const names = ['HindpawCT_0001.dcm', 's 1.dcm', 'ünï.dcm', '../../x.dcm', 'https://evil.example/x.dcm'];
    for (const n of names) {
      expect(sampleSliceUrl('sample2', n)).toBe('demo/sample2/' + encodeURIComponent(n));
      expect(sampleCacheKey('https://o', 'sample2', n)).toBe('https://o/__vrl-sample/v1/sample2/' + encodeURIComponent(n));
      expect(sampleSliceFileName(n)).toBe(n);
    }
    expect(sampleCacheKey('https://o', 'sample1', 'a.dcm')).toBe('https://o/__vrl-sample/v1/a.dcm');
    const { run } = loadSampleDemoFromSource();
    const { result } = await run('sample2', ['HindpawCT_0001.dcm', 's 1.dcm']);
    expect(result.map(f => f.name)).toEqual(['HindpawCT_0001.dcm', 's 1.dcm']);
  });

  it('only the exact one-level shape is split; every other name with a / (or a bad segment) stays ONE encoded segment', () => {
    for (const n of ['A/b.dcm', 'a/b/c.dcm', 'a//b.dcm', '../x.dcm', '/a.dcm', 'a\\b.dcm', 'a/b.txt', './a.dcm', 'a/../b.dcm', 'a/.', 'a/', '/', '1a/b.dcm', '-a/b.dcm', 'a b/c.dcm', 'a/b\\c.dcm', 'a/b.dcm/x']) {
      expect(sampleSliceUrl('sample2', n), n).toBe('demo/sample2/' + encodeURIComponent(n));
      expect(sampleSliceFileName(n), n).toBe(n);
    }
    expect(sampleSliceUrl('sample2', 'a-1/x?y#z.dcm')).toBe('demo/sample2/a-1/x%3Fy%23z.dcm'); // a query / fragment inside the file segment is encoded, never a query
    expect(sampleSliceUrl('sample2', 'ct/b.dcm', '/r/pr-preview/pr-3/')).toBe('demo/sample2/ct/b.dcm');
  });

  it('with a slice root (the published site without .dcm), the index stays on the site and only the slices come from <root>demo/<id>/', async () => {
    const ROOT = 'https://raw.githubusercontent.com/o/r/main/docs/';
    const names = ['s 1.dcm', '../../x.dcm', 'https://evil.example/x.dcm'];
    const { run } = loadSampleDemoFromSource();
    const { fetched } = await run('sample3', names, { deps: { sampleSliceUrl: (id, n, p) => sampleSliceUrl(id, n, p, ROOT) } });
    const targets = fetched.map(f => new URL(f.url, SITE).href);
    expect(targets[0]).toBe(`${SITE}demo/sample3/index.json`);
    expect(targets.slice(1).sort()).toEqual(names.map(n => ROOT + 'demo/sample3/' + encodeURIComponent(n)).sort());
    expect(fetched.every(f => f.opts.credentials === 'omit')).toBe(true);
  });

  const UNKNOWN = ['sample0', 'sample99', 'unlisted-folder', 'Sample1', ' sample1', 'sample1 ', '', '../sample1', 'sample1/..', 'sample1/', 'https://evil.example/', '//evil.example/', null, 0, 1, {}];
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
  // Object.prototype names are not registered ids, so they are refused like any unknown id.
  it('names of Object.prototype members are refused too', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(() => sampleIndexUrl(id)).toThrow(/Unknown sample set/);
  });

  it('static: the loading calls fetch only with a url that loadSampleDemo builds from sampleIndexUrl(setId) / sampleSliceUrl(setId, name), and never itself', () => {
    const { fnSrc } = loadSampleDemoFromSource();
    const fetchArgs = code => {
      const ast = parse(`(${code})`, { ecmaVersion: 'latest' }), out = [];
      full(ast, n => { if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'fetch') out.push(`(${code})`.slice(n.arguments[0].start, n.arguments[0].end)); });
      return out;
    };
    // loadSampleDemo itself makes no request: the index is read by fetchSampleIndex(sampleIndexUrl(setId)), the slices by fetchSliceFiles with the set's own url / key / file name functions
    expect(fetchArgs(fnSrc)).toEqual([]);
    expect(fnSrc).toContain('fetchSampleIndex(sampleIndexUrl(setId))');
    expect(fnSrc).toContain('sliceUrl:n=>sampleSliceUrl(setId,n)');
    expect(fnSrc).toContain('cacheKey:n=>sampleCacheKey(location.origin,setId,n)');
    expect(fnSrc).toContain('fileName:sampleSliceFileName');
    // the two helpers: one fetch each, with `url` (the index url handed in / the slice url built from the set's sliceUrl)
    const src = readDocs('data-load.js'), ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    const helper = name => { const d = ast.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); return src.slice(d.start, d.end); };
    expect(fetchArgs(helper('fetchSampleIndex'))).toEqual(['url']);
    const slices = helper('fetchSliceFiles');
    expect(fetchArgs(slices)).toEqual(['url']);
    const urlInits = [];
    full(parse(`(${slices})`, { ecmaVersion: 'latest' }), n => { if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'url') urlInits.push(`(${slices})`.slice(n.init.start, n.init.end)); });
    expect(urlInits).toEqual(['new URL(src.sliceUrl(names[i]),location.href).href']);
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
    // the event path hands over only an id that follows the folder name rule (sample-sets.js isSampleId); the chooser buttons pass their data-sample-set
    expect(app).toContain("if(isSampleId(id))e.detail.done=startSample(id)");
  });

  it('static: every fetch( in docs/ targets a registry / table-built URL, the version file, or a worker-local function', () => {
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
      'data-load.js: memberProjectUrl(id,dir)', // the .vrlab of a partner folder listed by docs/sample-pairs.json (sample-sets.js memberSet)
      'data-load.js: memberProjectUrl(id,dir)', // the same .vrlab again, only when findSamplePartners did not hand its bytes over (loadSamplePartnerProject, stage 2 of the sample pairs)
      'data-load.js: samplePairsUrl()', // docs/sample-pairs.json (one read, on demand)
      'data-load.js: url', // the index (fetchSampleIndex)
      'sample-registry.js: sampleJsonUrl(id)', // sample.json of a LISTED folder, built by the folder-name rule (sample-sets.js)
      'sample-registry.js: sampleListUrl()', // the list demo/samples.json (one read)
      'data-load.js: url',
      'source-filters.js: k', // a local slice-prefetch function named fetch, not window.fetch
    ].sort());
  });
});
