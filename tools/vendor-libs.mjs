#!/usr/bin/env node
// Vendors every third-party library the app loads into docs/vendor/<package>@<version>/ so that the app (the private
// version and the public trial) loads NOTHING from an external CDN.
//
//   node tools/vendor-libs.mjs            # rebuild docs/vendor from the npm registry (needs network and npm)
//   node tools/vendor-libs.mjs --check    # rebuild into a temp dir and compare with docs/vendor (exit 1 on any difference)
//
// How it is made (reproducible):
//   * Every package is fetched with `npm pack <name>@<version>` and the tarball is checked against the pinned sha512
//     integrity below (the same value npm records in package-lock.json for the packages that are also in the lock file).
//   * three, fflate: the package's own ESM files are copied as they are (three: build/three.core.js, three.module.js,
//     three.webgpu.js - the same files cdn.jsdelivr.net served for the URLs the app used before).
//   * dicom-parser has no ESM build (only a UMD file): a small esbuild bundle turns dist/dicomParser.min.js into an ES module
//     with a default export (what esm.sh did on the fly). The `zlib` require of the UMD wrapper is the Node-only inflate path;
//     it is mapped to an empty stub.
//   * DICOM codecs (compressed series): one esbuild bundle of @cornerstonejs/dicom-image-loader's decoders (shared/decoders/index.js:
//     RLE, JPEG baseline 8/12 bit, JPEG lossless, JPEG-LS, JPEG 2000, HTJ2K) with its JS codecs (jpeg-lossless-decoder-js) and
//     the emscripten glue of the four codec packages. The .wasm files are copied next to it; the worker (docs/dicom-codec-worker.js)
//     tells the decoders where they are (wasmBasePath). The rest of the loader (it needs @cornerstonejs/core / metadata) is not used.
//   * docs/vendor/MANIFEST.json lists the sha256 of every vendored file. The public-trial gate (tools/lib/public-gate.mjs)
//     checks the files against it, which is the only reason third-party code may skip the gate's source rules.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(REPO, 'docs/vendor');

// name, version, npm integrity (sha512)
export const PACKAGES = {
  three: ['three', '0.186.0', 'sha512-cr/fIM2ddMSVbYVgkfD4jLJv7Fh/8ZTjvo+7gQeSVGUZHxpx9FDwoL5iC7hUz/LiRA8wMbqfnb90xKfm1/HHkQ=='],
  dicomParser: ['dicom-parser', '1.8.21', 'sha512-lYCweHQDsC8UFpXErPlg86Px2A8bay0HiUY+wzoG3xv5GzgqVHU3lziwSc/Gzn7VV7y2KeP072SzCviuOoU02w=='],
  fflate: ['fflate', '0.8.2', 'sha512-cPJU47OaAoCbg0pBvzsgpTPhmhqI5eJjh/JIu8tPj5q+T7iLvW/JAYUqmE7KOB4R1ZyEhzBaIQpQpardBF5z8A=='],
  loader: ['@cornerstonejs/dicom-image-loader', '5.10.8', 'sha512-OBkaUv4YaNsk2hezl3XMrcKWs/QzL1HcS/3wzxe32j6FSRmTBO7QLrhUgH79R3nX+snBg9uJgr3QGR07I7KGOg=='],
  charls: ['@cornerstonejs/codec-charls', '1.2.5', 'sha512-BoENE2cXfzQ2RMxPfMMJxyv7E78iErTCB8b8lod/qv3dsYfCmSOUQKiRsuOZJM24JrjCFnyzbkxhAnF8gAKQnQ=='],
  openjph: ['@cornerstonejs/codec-openjph', '2.4.9', 'sha512-iUGvF8r4SMHFrHGjwhNsTlHDPm+fIcGw3fUYm4vzhsf2J6VR9DqHtynXwUVOCBMSG9YTyWkcsD4db++0kMffMw=='],
  openjpeg: ['@cornerstonejs/codec-openjpeg', '1.3.2', 'sha512-IsvhGRZ/3LzoNQFyAsKKzPw/S769b9JrKhpufU8uEEalOBn+D1OLetzZ48pvpbwxR4J7ZFrnK0FBIYtl8Hdt9Q=='],
  libjpeg: ['@cornerstonejs/codec-libjpeg-turbo-8bit', '1.2.4', 'sha512-k5e2/EjE9gV7dkg2x3CzId6mp6P7tTya/AmnLzbN3fZTW6skTMrOTJfqowgGQBzX7styLdcsnjlqwEVqeqaaHQ=='],
  jpegLossless: ['jpeg-lossless-decoder-js', '2.1.2', 'sha512-fYf/plymnuKwVw+s8gJ8O/BPw8y8OLaN11MBvEcT05kuy3m45o7BEC4J0JbxMNUYyO+MdK/I/jq0q1gkVYZm2Q=='],
};
// name of the codec bundle directory (one directory for the loader's decoders and the codec packages they bundle)
export const CODEC_DIR = 'cornerstone-dicom-codecs@5.10.8';

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
};
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// npm pack + integrity check + extract: returns the package directory (tmp/<dir>/package)
function fetchPackage(tmp, key) {
  const [name, version, integrity] = PACKAGES[key];
  const dir = join(tmp, 'pkg', `${name.replace('@', '').replace('/', '-')}-${version}`);
  mkdirSync(dir, { recursive: true });
  run('npm', ['pack', `${name}@${version}`, '--pack-destination', dir], { cwd: dir });
  const file = join(dir, readdirSync(dir).find(n => n.endsWith('.tgz')));
  const actual = 'sha512-' + createHash('sha512').update(readFileSync(file)).digest('base64');
  if (actual !== integrity) throw new Error(`${name}@${version}: integrity mismatch\n  expected ${integrity}\n  actual   ${actual}`);
  run('tar', ['xzf', file, '-C', dir]);
  return join(dir, 'package');
}

export async function buildVendor(out) {
  const tmp = mkdtempSync(join(tmpdir(), 'vendor-libs-'));
  try {
    const pk = Object.fromEntries(Object.keys(PACKAGES).map(k => [k, fetchPackage(tmp, k)]));
    const put = (dir, name, bytes) => { const p = join(out, dir, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); };
    const copy = (key, dir, from, to = from) => put(dir, to, readFileSync(join(pk[key], from)));
    const dirOf = key => `${PACKAGES[key][0].replace(/^@[^/]+\//, '')}@${PACKAGES[key][1]}`;

    // ---- three: the three build files the app imports (three.webgpu.js and three.module.js both import ./three.core.js)
    const t = dirOf('three');
    for (const f of ['build/three.core.js', 'build/three.module.js', 'build/three.webgpu.js', 'LICENSE']) copy('three', t, f);

    // ---- fflate: the package's browser ESM build (single file, no imports)
    const f = dirOf('fflate');
    copy('fflate', f, 'esm/browser.js', 'index.js');
    copy('fflate', f, 'LICENSE');

    // ---- helpers for the esbuild bundles
    const stubs = join(tmp, 'stubs');
    mkdirSync(stubs, { recursive: true });
    writeFileSync(join(stubs, 'empty.js'), 'export default {};\n');
    const common = { bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'error', legalComments: 'inline',
      mainFields: ['module', 'main'], conditions: ['import', 'default'], alias: { zlib: join(stubs, 'empty.js'), fs: join(stubs, 'empty.js'), path: join(stubs, 'empty.js') } };
    const bundle = async (opts) => {
      const r = await build({ ...common, absWorkingDir: tmp, ...opts }); // absWorkingDir: the paths esbuild writes into comments are relative to the temp dir, so the output does not depend on its random name
      if (r.outputFiles.length !== 1) throw new Error('expected one output file');
      return r.outputFiles[0].text;
    };

    // ---- dicom-parser: UMD -> ES module (default export)
    const d = dirOf('dicomParser');
    writeFileSync(join(tmp, 'dp-entry.js'), `import dicomParser from ${JSON.stringify(join(pk.dicomParser, 'dist/dicomParser.min.js'))};\nexport default dicomParser;\n`);
    put(d, 'index.js', await bundle({ entryPoints: [join(tmp, 'dp-entry.js')] }));
    copy('dicomParser', d, 'LICENSE');

    // ---- DICOM codecs: decoders of dicom-image-loader + the codec packages (glue bundled, wasm copied)
    const nm = join(tmp, 'node_modules');
    for (const key of ['loader', 'charls', 'openjph', 'openjpeg', 'libjpeg', 'jpegLossless']) {
      const dest = join(nm, ...PACKAGES[key][0].split('/'));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(pk[key], dest, { recursive: true });
    }
    const entry = join(tmp, 'codecs-entry.js');
    writeFileSync(entry, `export { decoders, initializers } from ${JSON.stringify(join(nm, '@cornerstonejs/dicom-image-loader/dist/esm/shared/decoders/index.js'))};\n`);
    const c = CODEC_DIR;
    // the glue files are CommonJS/UMD emscripten modules; esbuild wraps them. nodePaths lets the bare imports find the packages above.
    put(c, 'decoders.js', await bundle({ entryPoints: [entry], nodePaths: [nm], resolveExtensions: ['.js', '.mjs'] }));
    for (const [key, wasm] of [['openjph', 'openjphjs.wasm'], ['openjpeg', 'openjpegwasm_decode.wasm'], ['charls', 'charlswasm_decode.wasm'], ['libjpeg', 'libjpegturbowasm_decode.wasm']])
      copy(key, `${c}/wasm`, `dist/${wasm}`, wasm);
    // licence files of every package that ends up in the bundle (the codec packages carry only their own wrapper licence)
    for (const key of ['loader', 'charls', 'openjph', 'openjpeg', 'libjpeg', 'jpegLossless']) copy(key, `${c}/licenses/${PACKAGES[key][0].replace('@', '').replace('/', '-')}@${PACKAGES[key][1]}`, 'LICENSE');

    // ---- versions / manifest
    const manifest = { generatedBy: 'tools/vendor-libs.mjs', packages: Object.fromEntries(Object.values(PACKAGES).map(([n, v, i]) => [`${n}@${v}`, i])), entries: {} };
    const walk = dir => readdirSync(dir).sort().flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const p of walk(out)) {
      const rel = relative(out, p).split(sep).join('/');
      if (rel !== 'MANIFEST.json') manifest.entries[rel] = { sha256: sha256(readFileSync(p)), size: statSync(p).size };
    }
    writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const out = check ? mkdtempSync(join(tmpdir(), 'vendor-check-')) : VENDOR;
  if (!check) rmSync(out, { recursive: true, force: true });
  await buildVendor(out);
  if (check) {
    const a = JSON.parse(readFileSync(join(out, 'MANIFEST.json'), 'utf8')), b = JSON.parse(readFileSync(join(VENDOR, 'MANIFEST.json'), 'utf8'));
    rmSync(out, { recursive: true, force: true });
    if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('vendor-libs: docs/vendor differs from a fresh build'); process.exit(1); }
    console.log('vendor-libs: docs/vendor matches a fresh build');
  } else console.log(`vendor-libs: wrote ${relative(REPO, out)}`);
}
