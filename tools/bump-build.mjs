// Bump the deployed build marker everywhere it appears, in one step:
//   docs/version.js (APP_VERSION / APP_BUILD), docs/version.json, and every
//   `?v=YYYYMMDD-buildN` cache-busting query in docs/*.js and docs/index.html.
//
//   node tools/bump-build.mjs          # next build number, today's date
//   node tools/bump-build.mjs 200      # explicit build number
//
// tests/static/build-consistency.test.js fails if any marker is left behind.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const versionJs = readFileSync('docs/version.js', 'utf8');
const current = versionJs.match(/const APP_BUILD='([^']+)'/)[1];
const build = process.argv[2] || String(Math.floor(Number(current)) + 1);
const d = new Date();
const ymd = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')];
const version = `${ymd.join('.')}-${build}`, tag = `${ymd.join('')}-build${build}`;

const files = [...readdirSync('docs').filter(f => f.endsWith('.js')).map(f => `docs/${f}`), 'docs/index.html'];
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  const before = s;
  s = s.replace(/\?v=[0-9]+-build[^'"&\s)]*/g, `?v=${tag}`); // includes free-form suffixes like -groupedcut1
  if (f === 'docs/version.js') s = s.replace(/const APP_VERSION='[^']+';/, `const APP_VERSION='${version}';`).replace(/const APP_BUILD='[^']+';/, `const APP_BUILD='${build}';`);
  if (s !== before) { writeFileSync(f, s); console.log('updated', f); }
}
writeFileSync('docs/version.json', JSON.stringify({ build, version }, null, 2) + '\n');
console.log(`build ${current} -> ${build} (${version})`);
