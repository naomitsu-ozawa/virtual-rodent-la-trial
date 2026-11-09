// The pure parts of tools/make-event-thumbs.mjs (the card pictures of the 体験会 page): arguments, jobs, browser choice, crop, checks. No browser, no server, no file system here: tests/unit/event-thumbs.test.js.
import { join } from 'node:path';

export const THUMB_W = 640, THUMB_H = 360;
export const THUMB_FILE = 'thumb.webp';

// ---- pure parts (unit-tested)
// args: --only a,b  --browser x  --timeout seconds  --headless  --port n  --help ; env: THUMB_BROWSER, THUMB_BROWSER_PATH
export function parseArgs(argv = [], env = {}) {
  const o = { only: null, browser: env.THUMB_BROWSER || 'chrome', executablePath: env.THUMB_BROWSER_PATH || '', timeoutMs: 600000, headless: false, port: 0, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--only') o.only = String(next() || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--browser') { const b = String(next() || ''); if (/[\\/]|\.exe$/i.test(b)) o.executablePath = b; else o.browser = b; }
    else if (a === '--timeout') o.timeoutMs = Math.max(10, Number(next()) || 600) * 1000;
    else if (a === '--port') o.port = Number(next()) || 0;
    else if (a === '--headless') o.headless = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown option: ' + a);
  }
  return o;
}
// the datasets to do, with where each picture goes (path.join: Windows and POSIX); an unknown name in `only` is an error
export function thumbJobs(datasets, docsDir, only = null) {
  const known = datasets.map(d => d.sample);
  for (const s of only || []) if (!known.includes(s)) throw new Error('unknown dataset: ' + s + ' (known: ' + known.join(', ') + ')');
  return datasets.filter(d => !only || only.includes(d.sample)).map(d => ({ sample: d.sample, id: d.id, out: join(docsDir, 'demo', d.sample, THUMB_FILE) }));
}
// the browsers to try, in order: an executable path wins; else the channel asked for, then the other one ('chrome' -> 'msedge')
export function launchPlans({ browser = 'chrome', executablePath = '', headless = false } = {}) {
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  if (executablePath) return [{ label: executablePath, options: { executablePath, headless, args } }];
  const order = browser === 'msedge' ? ['msedge', 'chrome'] : browser === 'chrome' ? ['chrome', 'msedge'] : [browser];
  return order.map(channel => ({ label: channel, options: { channel, headless, args } }));
}
// the largest 16:9 (dstW:dstH) box inside a w x h picture, centred: the source rectangle to draw into the thumbnail
export function coverRect(w, h, dstW = THUMB_W, dstH = THUMB_H) {
  const r = dstW / dstH;
  const sw = w / h > r ? Math.round(h * r) : w, sh = w / h > r ? h : Math.round(w / r);
  return { sx: Math.floor((w - sw) / 2), sy: Math.floor((h - sh) / 2), sw, sh };
}
// width / height of a PNG (its IHDR chunk: bytes 16-23)
export function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
// a picture that is (nearly) one colour was taken before the 3D view was drawn: mean absolute deviation of the luminance samples
export function looksBlank(lumaSamples, minDeviation = 2) {
  if (!lumaSamples.length) return true;
  const mean = lumaSamples.reduce((a, b) => a + b, 0) / lumaSamples.length;
  return lumaSamples.reduce((a, b) => a + Math.abs(b - mean), 0) / lumaSamples.length < minDeviation;
}

