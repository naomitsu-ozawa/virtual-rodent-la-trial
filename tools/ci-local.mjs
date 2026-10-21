// Runs the checks of .github/workflows/ci.yml locally, in order, and stops at
// the first failure. The step list is read from ci.yml itself, so this stays in
// sync with CI. Skipped: `npm ci` and `npx playwright install` (setup only).
//   node tools/ci-local.mjs            all jobs
//   node tools/ci-local.mjs unit       one job (unit)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const only = process.argv[2];
const steps = [];
let job = null;
for (const line of yml.split('\n')) {
  const j = line.match(/^ {2}([\w-]+):\s*$/);
  if (j) { job = j[1]; continue; }
  const r = line.match(/^\s+(?:- )?run: (.+)$/);
  if (!r || !job) continue;
  const cmd = r[1].trim();
  if (cmd === 'npm ci' || cmd.startsWith('npx playwright install')) continue;
  if (!only || only === job) steps.push({ job, cmd });
}
if (!steps.length) { console.error(`no steps${only ? ` for job "${only}"` : ''}`); process.exit(2); }

const t0 = Date.now();
for (const { job, cmd } of steps) {
  console.log(`\n=== [${job}] ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nFAILED [${job}] ${cmd} (exit ${r.status})`); process.exit(1); }
}
console.log(`\nall ${steps.length} CI steps passed in ${Math.round((Date.now() - t0) / 1000)}s`);
