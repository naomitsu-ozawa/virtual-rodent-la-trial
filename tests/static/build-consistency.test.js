import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// docs/app.js compares APP_BUILD (from docs/version.js) with docs/version.json on startup and
// force-reloads the page when they differ (ensureLatestDeployedBuild). If the
// markers drift apart, users get stale assets or reload loops.
//
// Conventions used by this project (keep the test permissive about them):
// - APP_BUILD is an integer build ("184"); APP_VERSION may carry an
//   iteration suffix ("2026.09.25-184.10").
// - Cache-busting queries look like ?v=YYYYMMDD-build<BUILD> optionally
//   followed by a free-form suffix (?v=20260925-build184-groupedcut1), and
//   different files may carry different suffixes.
const read = p => readFileSync(p, 'utf8');
const versionJs = read('docs/version.js');
const indexHtml = read('docs/index.html');
const versionJson = JSON.parse(read('docs/version.json'));

const build = versionJs.match(/const APP_BUILD='([^']+)'/)?.[1];
const version = versionJs.match(/const APP_VERSION='([^']+)'/)?.[1];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tagFor = () => new RegExp(`^\\?v=[0-9]{8}-build${esc(build)}(?![0-9])[\\w.-]*$`);

describe('build markers', () => {
  it('version.js declares APP_BUILD and APP_VERSION', () => {
    expect(build).toBeTruthy();
    expect(version).toBeTruthy();
  });

  it('version.json matches version.js (prevents the reload loop)', () => {
    expect(String(versionJson.build)).toBe(build);
    expect(String(versionJson.version)).toBe(version);
  });

  it('APP_VERSION ends with the build number (optionally .iteration)', () => {
    expect(version).toMatch(new RegExp(`-${esc(build)}(\\.[0-9]+)?$`));
  });

  it('index.html cache-busting queries belong to this build', () => {
    const tags = [...indexHtml.matchAll(/(\?v=[^"']+)/g)].map(m => m[1]);
    expect(tags.length).toBeGreaterThanOrEqual(2); // style.css + app.js
    for (const t of tags) expect(t).toMatch(tagFor());
  });

  // Every relative import in every deployed module must carry a tag of the
  // current build, otherwise browsers can combine fresh and stale modules.
  const modules = readdirSync('docs').filter(f => f.endsWith('.js'));
  it.each(modules)('relative imports in %s are tagged with this build', file => {
    const src = read(`docs/${file}`);
    for (const [, spec] of src.matchAll(/\bfrom\s*['"](\.\/[^'"]+)['"]/g)) {
      const q = spec.slice(spec.indexOf('?'));
      expect(spec.includes('?'), `${file}: ${spec} has no ?v= tag`).toBe(true);
      expect(q, `${file}: ${spec}`).toMatch(tagFor());
    }
  });

  it('every relative import resolves to an existing file', () => {
    for (const file of modules) {
      for (const [, spec] of read(`docs/${file}`).matchAll(/\bfrom\s*['"]\.\/([^'"?]+)/g)) {
        expect(existsSync(`docs/${spec}`), `${file} -> ${spec}`).toBe(true);
      }
    }
  });
});
