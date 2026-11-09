import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { thumbDatasets, parseArgs, thumbJobs, launchPlans, coverRect, looksBlank, pngSize, THUMB_W, THUMB_H, THUMB_FILE } from '../../tools/lib/event-thumbs.mjs';
import { EVENT_DATASETS } from '../../docs/event-mode.js';
import { registry } from '../../docs/sample-registry.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// tools/make-event-thumbs.mjs (the card pictures; run on a Windows PC with a GPU). Its pure parts are in tools/lib/event-thumbs.mjs; the checks of the tool file itself (no POSIX-only code, never exported) are in public-exclude.test.js.
describe('make-event-thumbs: the jobs', () => {
  it('the datasets are listed from the folders (the registry), in the order of the cards: levels first, then the others', () => {
    expect(thumbDatasets(registry)).toEqual([{ sample: 'sample4', id: 'lv0' }, { sample: 'sample3', id: 'lv1' }, { sample: 'sample2', id: 'lv2' }, { sample: 'sample1', id: 'lv3' }, { sample: 'sample5', id: 'sample5' }, { sample: 'sample6', id: 'sample6' }]);
    expect(thumbJobs(thumbDatasets(registry), join('D', 'docs')).map(j => j.sample)).toEqual(EVENT_DATASETS.map(d => d.sample));
  });
  it('one picture per dataset of the card list, docs/demo/<sampleN>/thumb.webp, 640 x 360', () => {
    const jobs = thumbJobs(EVENT_DATASETS, join('D', 'docs'));
    expect(jobs.map(j => j.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5', 'sample6']);
    expect(jobs[0].out).toBe(join('D', 'docs', 'demo', 'sample4', 'thumb.webp'));
    expect(THUMB_FILE).toBe('thumb.webp'); expect([THUMB_W, THUMB_H]).toEqual([640, 360]);
    expect(thumbJobs(EVENT_DATASETS, 'docs', ['sample5']).map(j => j.sample)).toEqual(['sample5']);
    expect(() => thumbJobs(EVENT_DATASETS, 'docs', ['sample9'])).toThrow(/unknown dataset/);
  });
  it('the card page looks for the same file name (event-launcher-core.js eventCards: thumbFile)', async () => {
    const { eventCards } = await import('../../docs/event-launcher-core.js');
    for (const c of eventCards()) expect(c.thumbFile).toBe(THUMB_FILE);
  });
});
describe('make-event-thumbs: options and the browser (Windows: installed Chrome or Edge, no playwright install)', () => {
  it('defaults: Chrome, headed, 10 minutes; --only / --browser / --timeout / --headless; the environment variables', () => {
    expect(parseArgs([], {})).toMatchObject({ only: null, browser: 'chrome', executablePath: '', timeoutMs: 600000, headless: false, help: false });
    expect(parseArgs(['--only', 'sample4, sample5', '--timeout', '900', '--headless'], {})).toMatchObject({ only: ['sample4', 'sample5'], timeoutMs: 900000, headless: true });
    expect(parseArgs(['--browser', 'msedge'], {}).browser).toBe('msedge');
    expect(parseArgs(['--browser', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'], {}).executablePath).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(parseArgs([], { THUMB_BROWSER: 'msedge' }).browser).toBe('msedge');
    expect(parseArgs([], { THUMB_BROWSER_PATH: 'C:\\x\\msedge.exe' }).executablePath).toBe('C:\\x\\msedge.exe');
    expect(() => parseArgs(['--nope'])).toThrow(/unknown option/);
  });
  it("launches the installed browser by channel: 'chrome', then 'msedge' (and the other way round); a path wins; WebGPU is switched on", () => {
    expect(launchPlans({}).map(p => p.options.channel)).toEqual(['chrome', 'msedge']);
    expect(launchPlans({ browser: 'msedge' }).map(p => p.options.channel)).toEqual(['msedge', 'chrome']);
    const byPath = launchPlans({ executablePath: 'C:\\x\\chrome.exe' });
    expect(byPath).toHaveLength(1); expect(byPath[0].options.executablePath).toBe('C:\\x\\chrome.exe'); expect(byPath[0].options.channel).toBeUndefined();
    for (const p of launchPlans({})) { expect(p.options.args).toContain('--enable-unsafe-webgpu'); expect(p.options.headless).toBe(false); }
    expect(launchPlans({ headless: true })[0].options.headless).toBe(true);
  });
  it('the installed Playwright (1.63) needs no browser download for a channel: @playwright/test is a plain dependency with no install script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@playwright/test']).toBe('1.63.0');
    expect(pkg.scripts.postinstall).toBeUndefined(); expect(pkg.scripts.install).toBeUndefined();
  });
});
describe('make-event-thumbs: the picture', () => {
  it('crops to 16:9 from the centre (the largest box that fits)', () => {
    expect(coverRect(1600, 900)).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 900 });
    expect(coverRect(1000, 1000)).toEqual({ sx: 0, sy: 218, sw: 1000, sh: 563 });
    expect(coverRect(1920, 800)).toEqual({ sx: 249, sy: 0, sw: 1422, sh: 800 }); // wider than 16:9: the sides go
    for (const [w, h] of [[1000, 1000], [1920, 800], [640, 480], [3000, 1700]]) { const r = coverRect(w, h); expect(r.sx + r.sw).toBeLessThanOrEqual(w); expect(r.sy + r.sh).toBeLessThanOrEqual(h); expect(Math.abs(r.sw / r.sh - 16 / 9)).toBeLessThan(0.01); }
  });
  it('PNG size from its header; a blank picture is told apart', () => {
    const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1234, 16); png.writeUInt32BE(567, 20);
    expect(pngSize(png)).toEqual({ w: 1234, h: 567 });
    expect(() => pngSize(Buffer.from('nope'))).toThrow(/not a PNG/);
    expect(looksBlank([])).toBe(true); expect(looksBlank([10, 10, 10, 10])).toBe(true); expect(looksBlank([0, 255, 0, 255])).toBe(false);
  });
});
