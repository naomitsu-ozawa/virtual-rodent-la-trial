import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { I18N } from '../../docs/i18n.js';
import {
  THEMES, THEME_IDS, THEME_STORAGE_KEY, DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME,
  THEME_ALIASES, normalizeThemeId, isThemeId, themeMode, resolveInitialTheme, readStoredTheme, writeStoredTheme, applyTheme, createThemeController,
} from '../../docs/theme.js';

const read = p => readFileSync(p, 'utf8');
const themesCss = read('docs/themes.css'), styleCss = read('docs/style.css');

// ---- helpers: tokens of each theme from themes.css ----
const block = sel => {
  const i = themesCss.indexOf(sel + '{'); expect(i, sel).toBeGreaterThanOrEqual(0);
  return themesCss.slice(i, themesCss.indexOf('}', i));
};
const tokensOf = text => Object.fromEntries([...text.matchAll(/--ui-([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const standard = tokensOf(block(':root'));
const themeTokens = id => id === 'dark-standard' ? standard : { ...standard, ...tokensOf(block('html[data-theme="' + id + '"]')) };
const rgbOf = v => v.split(/\s+/).map(Number);
const lum = ([r, g, b]) => { const f = c => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const x = lum(rgbOf(a)), y = lum(rgbOf(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---- fakes ----
const fakeStorage = (init = {}, { failGet = false, failSet = false } = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => { if (failGet) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (failSet) throw new Error('blocked'); m.set(k, String(v)); }, _m: m };
};
const fakeDoc = () => { const meta = { content: '', setAttribute(k, v) { this.content = v; } }; return { documentElement: { dataset: {} }, querySelector: s => (s === 'meta[name="theme-color"]' ? meta : null), _meta: meta }; };
const fakeMedia = light => { const l = []; const mq = { matches: light, addEventListener: (t, f) => l.push(f), _fire(v) { mq.matches = v; l.forEach(f => f({ matches: v })); } }; return { fn: () => mq, mq }; };

describe('theme list', () => {
  it('has three light and three dark themes with unique ids and a name in both languages', () => {
    expect(THEMES.length).toBe(6);
    expect(new Set(THEME_IDS).size).toBe(6);
    expect(THEMES.filter(t => t.mode === 'light').length).toBe(3);
    expect(THEMES.filter(t => t.mode === 'dark').length).toBe(3);
    for (const t of THEMES) {
      expect(t.id.startsWith(t.mode + '-'), t.id).toBe(true);
      expect(t.ja.length).toBeGreaterThan(0); expect(t.en.length).toBeGreaterThan(0);
      const k = t.id.replace(/-/g, '_');
      expect(I18N.ja['theme_' + k], t.id).toBe(t.ja); expect(I18N.en['theme_' + k], t.id).toBe(t.en);
      expect(I18N.ja['themeDesc_' + k]).toBeTruthy(); expect(I18N.en['themeDesc_' + k]).toBeTruthy();
    }
    expect(THEMES.find(t => t.id === DEFAULT_DARK_THEME).mode).toBe('dark');
    expect(THEMES.find(t => t.id === DEFAULT_LIGHT_THEME).mode).toBe('light');
  });
  it('the UI has an option for every theme', () => {
    const ui = read('docs/ui-shell.js');
    for (const id of THEME_IDS) expect(ui).toContain('<option value="' + id + '" data-i18n="theme_' + id.replace(/-/g, '_') + '">');
  });
});

describe('saving and loading the choice', () => {
  it('round-trips through storage and ignores unknown values', () => {
    const s = fakeStorage();
    expect(readStoredTheme(s)).toBeNull();
    for (const id of THEME_IDS) { expect(writeStoredTheme(id, s)).toBe(true); expect(readStoredTheme(s)).toBe(id); }
    expect(s._m.get(THEME_STORAGE_KEY)).toBe(THEME_IDS.at(-1));
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'rainbow' }))).toBeNull();
  });
  it('a saved id of a renamed theme (the blue ones became gray) is read as the new id and saved again under it', () => {
    expect(THEME_ALIASES).toEqual({ 'light-cool': 'light-gray', 'dark-navy': 'dark-gray' });
    for (const [old, now] of Object.entries(THEME_ALIASES)) {
      expect(isThemeId(old)).toBe(false); expect(isThemeId(now)).toBe(true); expect(normalizeThemeId(old)).toBe(now);
      expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: old }))).toBe(now);
      expect(resolveInitialTheme(old, false)).toBe(now);
      const s = fakeStorage({ [THEME_STORAGE_KEY]: old }), doc = fakeDoc();
      const ctl = createThemeController({ storage: s, matchMedia: fakeMedia(true).fn, doc });
      expect(ctl.get()).toBe(now); expect(ctl.isChosen()).toBe(true); expect(s._m.get(THEME_STORAGE_KEY)).toBe(now);
      expect(doc.documentElement.dataset.theme).toBe(now);
    }
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'rainbow' }))).toBeNull();
  });
  it('never throws when storage is blocked (private window, cleared site data)', () => {
    expect(readStoredTheme(fakeStorage({}, { failGet: true }))).toBeNull();
    expect(writeStoredTheme('light-paper', fakeStorage({}, { failSet: true }))).toBe(false);
    expect(readStoredTheme(null)).toBeNull();
    const ctl = createThemeController({ storage: fakeStorage({}, { failGet: true, failSet: true }), matchMedia: fakeMedia(false).fn, doc: fakeDoc() });
    expect(ctl.get()).toBe('dark-standard');
    expect(ctl.set('light-gray')).toBe(true); // still applied for this session
    expect(ctl.get()).toBe('light-gray');
  });
});

describe('first visit follows the OS setting', () => {
  it('light OS -> light standard, dark or unknown OS -> dark standard, a saved choice always wins', () => {
    expect(resolveInitialTheme(null, true)).toBe('light-standard');
    expect(resolveInitialTheme(null, false)).toBe('dark-standard');
    expect(resolveInitialTheme('dark-gray', true)).toBe('dark-gray');
    expect(resolveInitialTheme('light-paper', false)).toBe('light-paper');
    expect(resolveInitialTheme('nonsense', true)).toBe('light-standard');
  });
  it('the controller applies the OS theme, then follows OS changes until the user chooses', () => {
    const doc = fakeDoc(), media = fakeMedia(true), storage = fakeStorage();
    const ctl = createThemeController({ storage, matchMedia: media.fn, doc });
    expect(ctl.get()).toBe('light-standard'); expect(doc.documentElement.dataset).toEqual({ theme: 'light-standard', themeMode: 'light' });
    expect(ctl.isChosen()).toBe(false); expect(storage._m.size).toBe(0); // following the OS stores nothing
    const seen = []; ctl.onChange((id, chosen) => seen.push([id, chosen]));
    media.mq._fire(false);
    expect(ctl.get()).toBe('dark-standard'); expect(doc.documentElement.dataset.themeMode).toBe('dark');
    ctl.set('light-paper');
    expect(storage._m.get(THEME_STORAGE_KEY)).toBe('light-paper'); expect(doc._meta.content).toBe(THEMES.find(t => t.id === 'light-paper').preview[0]);
    media.mq._fire(true); media.mq._fire(false); // the OS no longer matters
    expect(ctl.get()).toBe('light-paper');
    expect(seen).toEqual([['dark-standard', false], ['light-paper', true]]);
    expect(ctl.set('rainbow')).toBe(false);
  });
  it('a later visit starts from the saved choice', () => {
    const doc = fakeDoc();
    const ctl = createThemeController({ storage: fakeStorage({ [THEME_STORAGE_KEY]: 'dark-reading' }), matchMedia: fakeMedia(true).fn, doc });
    expect(ctl.get()).toBe('dark-reading'); expect(ctl.isChosen()).toBe(true); expect(doc.documentElement.dataset.theme).toBe('dark-reading');
  });
  it('applyTheme rejects unknown ids and themeMode follows the id', () => {
    expect(applyTheme('nope', fakeDoc())).toBe(false);
    expect(isThemeId('light-gray')).toBe(true); expect(themeMode('light-gray')).toBe('light'); expect(themeMode('dark-gray')).toBe('dark');
  });
  it('the inline script in index.html (set before the CSS loads) accepts every theme id and falls back like theme.js', () => {
    for (const f of ['docs/index.html', 'index.html']) {
      const html = read(f); const m = html.match(/<script>(try\{var t=localStorage[^<]*)<\/script>/); expect(m, f).toBeTruthy();
      const run = (stored, light) => {
        const root = { dataset: {} };
        new Function('localStorage', 'matchMedia', 'document', m[1])({ getItem: () => stored }, () => ({ matches: light }), { documentElement: root });
        return root.dataset;
      };
      for (const id of THEME_IDS) expect(run(id, false)).toEqual({ theme: id, themeMode: themeMode(id) });
      for (const [old, now] of Object.entries(THEME_ALIASES)) expect(run(old, false)).toEqual({ theme: now, themeMode: themeMode(now) });
      expect(run(null, true).theme).toBe('light-standard'); expect(run(null, false).theme).toBe('dark-standard'); expect(run('x', true).theme).toBe('light-standard');
      expect(html).toMatch(/themes\.css\?v=|\/docs\/themes\.css/);
    }
  });
});

describe('tokens', () => {
  it('every theme overrides the same tokens (nothing is left from another theme)', () => {
    const all = Object.keys(standard);
    for (const t of THEME_IDS) { const own = Object.keys(themeTokens(t)); for (const k of all) expect(own, t + ' ' + k).toContain(k); }
    for (const t of THEME_IDS.filter(x => x !== 'dark-standard')) {
      const own = tokensOf(block('html[data-theme="' + t + '"]'));
      for (const k of all) expect(own[k], t + ' ' + k).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });
  it('the preview colours in theme.js are the real tokens', () => {
    for (const t of THEMES) { const tk = themeTokens(t.id); const hex = ['s0', 's1', 'blue-bd', 't1'].map(k => '#' + rgbOf(tk[k]).map(n => n.toString(16).padStart(2, '0')).join('')); expect(t.preview, t.id).toEqual(hex); }
  });
  it('every var(--ui-*) in style.css is defined', () => {
    for (const m of (styleCss + read('docs/analysis-results.js')).matchAll(/var\(--ui-([\w-]+)\)/g)) expect(standard, m[1]).toHaveProperty(m[1]);
  });
});

describe('contrast (WCAG AA, 4.5:1) in all six themes', () => {
  // (text, background) pairs taken from the rules of style.css that set both, plus text-only rules against the surfaces
  const rules = [...styleCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
  const pairs = new Map();
  const surfaces = ['s0', 's1', 's2', 's3'];
  for (const { sel, body } of rules) {
    const t = [...body.matchAll(/(?<![\w-])color\s*:\s*rgb\(var\(--ui-([\w-]+)\)/g)].map(m => m[1]);
    const b = [...body.matchAll(/(?<![\w-])background(?:-color)?\s*:[^;]*?rgb\(var\(--ui-([\w-]+)\)/g)].map(m => m[1]);
    for (const x of t) for (const y of b) pairs.set(x + '|' + y, sel);
    if (t.length && !b.length) for (const x of t) for (const s of surfaces) if (!pairs.has(x + '|' + s)) pairs.set(x + '|' + s, sel + ' (text on the surface)');
  }
  it('finds the pairs', () => { expect(pairs.size).toBeGreaterThan(30); });
  it.each(THEME_IDS)('%s: every text colour on its background is at least 4.5:1', id => {
    const tk = themeTokens(id), bad = [];
    for (const [k, sel] of pairs) { const [x, y] = k.split('|'); const c = contrast(tk[x], tk[y]); if (c < 4.5) bad.push(x + ' on ' + y + ' = ' + c.toFixed(2) + ' (' + sel.slice(0, 60) + ')'); }
    expect(bad).toEqual([]);
  });
  it.each(THEME_IDS)('%s: all five text levels on all five surfaces (strong text on raised surfaces)', id => {
    const tk = themeTokens(id);
    for (const t of ['t1', 't2', 't3', 't4', 't5']) for (const s of ['s0', 's1', 's2', 's3']) expect(contrast(tk[t], tk[s]), t + ' on ' + s).toBeGreaterThanOrEqual(4.5);
    for (const t of ['t1', 't2', 't3']) expect(contrast(tk[t], tk.s4), t + ' on s4').toBeGreaterThanOrEqual(4.5);
  });
  it.each(THEME_IDS)('%s: the themes differ from each other (not the same palette under another name)', id => {
    const tk = themeTokens(id); for (const o of THEME_IDS.filter(x => x !== id)) expect(tk.s1 + tk.t1, id + ' vs ' + o).not.toBe(themeTokens(o).s1 + themeTokens(o).t1);
  });
});

describe('the image does not change with the theme; the backgrounds around it follow it', () => {
  it('the 2D canvas background follows the theme; the 3D one is a dark, theme-tinted colour; the 3D card keeps dark UI tokens', () => {
    expect(themesCss).not.toMatch(/\.viewport-card|(?<!-)\.view-card(?!-3d)/); // no general card re-declaration
    expect(themesCss.match(/\.view-card-3d\{/g).length).toBe(1);
    const card3d = tokensOf(block('.view-card-3d'));
    for (const k of Object.keys(standard).filter(x => !x.startsWith('canvas-bg'))) expect(card3d[k], k).toBe(standard[k]);
    for (const k of ['canvas-bg-3d', 'canvas-bg-2d']) expect(card3d, k).not.toHaveProperty(k.replace('canvas-bg-', 'canvas-bg-'));
    expect(standard['canvas-bg-3d']).toBe('28 36 42'); expect(standard['canvas-bg-2d']).toBe('2 3 4'); // the standard dark theme keeps today's 2D background
    expect(styleCss).toMatch(/\.view-card-3d\{background:rgb\(var\(--ui-canvas-bg-3d\)\)\}/);
    expect(styleCss).toMatch(/\.viewport-card\{[^}]*background:rgb\(var\(--ui-canvas-bg-2d\)\)/);
    expect(styleCss).toMatch(/\.mpr-canvas\{[^}]*background:rgb\(var\(--ui-canvas-bg-2d\)\)/);
    expect(styleCss).not.toMatch(/\.viewer-grid\{background/);
  });
  it('every theme sets both backgrounds: 3D dark in all six, 2D light in the light themes and dark in the dark ones', () => {
    for (const t of THEMES) {
      const tk = themeTokens(t.id);
      for (const k of ['canvas-bg-3d', 'canvas-bg-2d']) expect(tk[k], t.id + ' ' + k).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      const l3 = lum(rgbOf(tk['canvas-bg-3d'])), l2 = lum(rgbOf(tk['canvas-bg-2d']));
      // dark enough for the volume and the white-ish UI to read
      if (t.id !== 'dark-reading') expect(l3, t.id + ' 3D').toBeGreaterThan(0.01);
      expect(l3, t.id + ' 3D').toBeLessThan(0.05);
      if (t.mode === 'light') expect(l2, t.id + ' 2D').toBeGreaterThan(0.3); else expect(l2, t.id + ' 2D').toBeLessThan(0.02);
    }
    const own = id => tokensOf(block('html[data-theme="' + id + '"]'));
    for (const id of THEME_IDS.filter(x => x !== 'dark-standard')) expect(own(id)['canvas-bg-3d'], id).toBeTruthy();
  });
  it('the 3D backgrounds are tinted like their theme', () => {
    const c = id => rgbOf(themeTokens(id)['canvas-bg-3d']);
    expect(c('light-gray')[0]).toBe(c('light-gray')[2]); expect(c('dark-gray')[0]).toBe(c('dark-gray')[2]); // neutral gray
    expect(c('light-paper')[0]).toBeGreaterThan(c('light-paper')[2]); // warm brown-gray
    expect(c('dark-standard')[2]).toBeGreaterThan(c('dark-standard')[0]); expect(c('light-standard')[2]).toBeGreaterThan(c('light-standard')[0]); // bluish
    expect(Math.max(...c('dark-reading'))).toBeLessThanOrEqual(12); // almost black
    expect(Math.max(...c('light-paper')) - Math.min(...c('light-paper'))).toBeGreaterThanOrEqual(12); // the tint can be seen
    expect(c('light-gray')[0]).toBeGreaterThanOrEqual(38); expect(c('dark-gray')[0]).toBeGreaterThanOrEqual(30);
  });
  it('text and overlays on the canvas backgrounds stay readable (4.5:1): standard dark UI on the 3D view, the theme UI on the 2D one', () => {
    for (const id of THEME_IDS) {
      const tk = themeTokens(id);
      for (const t of ['t1', 't2', 't3']) {
        expect(contrast(standard[t], tk['canvas-bg-3d']), id + ' ' + t + ' on 3D').toBeGreaterThanOrEqual(4.5);
        expect(contrast(tk[t], tk['canvas-bg-2d']), id + ' ' + t + ' on 2D').toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('MedicalVolumeRenderer takes its background from the theme variable: clear colour and the colour of a ray that hits nothing', () => {
    const mv = read('docs/medical-volume.js');
    expect(mv).toContain("from './canvas-theme.js");
    // the shader: a background uniform, no fixed colour any more
    expect(mv).toMatch(/textureDims:vec4<f32>,\n background:vec4<f32>,\n segMat:array<vec4<f32>,4>\n\};\n@group\(0\) @binding\(0\) var<uniform> u:Uniforms;/); // segMat appended after it
    expect(mv).not.toMatch(/0\.035\s*,\s*0\.045\s*,\s*0\.05/);
    expect(mv.match(/return vec4<f32>\(u\.background\.rgb,1\.0\);/g).length).toBe(3);
    expect(mv).toContain('let bg=u.background.rgb;');
    // the uniform buffer holds the 23rd vec4 and is filled every frame; the canvas stays opaque
    expect(mv).toContain('size:432,usage:GPUBufferUsage.UNIFORM');
    expect(mv).toContain('this.frameData=new Float32Array(108);');
    expect(mv).toMatch(/const bg=canvasBackground3dUnit\(\);put\(22,bg\[0\],bg\[1\],bg\[2\],1\);/);
    expect(mv).toContain("alphaMode:'opaque'");
    expect(mv).toMatch(/clearValue:\{r:canvasBackground3dUnit\(\)\[0\],g:canvasBackground3dUnit\(\)\[1\],b:canvasBackground3dUnit\(\)\[2\],a:1\}/);
    expect(mv).toMatch(/clearValue:\{r:0,g:0,b:0,a:1\}/); // the blit of a low-resolution frame is fully covered, as before
    // only the background reaches the renderer from the theme code; nothing about the image
    expect(mv).not.toMatch(/data-theme|themeMode|theme-ui|from '\.\/theme\.js|--ui-(?!canvas-bg-3d)|getComputedStyle/);
  });
  it('canvas-theme.js: reads the CSS variable, falls back to the colour before themes, and follows a theme change', () => {
    const saved = { d: globalThis.document, g: globalThis.getComputedStyle };
    return import('../../docs/canvas-theme.js').then(m => {
      try {
        expect(m.DEFAULT_CANVAS_BG_3D).toEqual([0.035, 0.045, 0.05]);
        globalThis.document = undefined; globalThis.getComputedStyle = undefined;
        expect(m.canvasBackground3d()).toBeNull();
        let value = '9 12 13', handlers = [];
        globalThis.document = { documentElement: {}, addEventListener: (t, f) => { if (t === 'vrl-themechange') handlers.push(f); } };
        globalThis.getComputedStyle = () => ({ getPropertyValue: () => ' ' + value + ' ' });
        expect(m.canvasBackground3d()).toEqual([9, 12, 13]);
        expect(m.canvasBackground3dUnit()).toEqual([9 / 255, 12 / 255, 13 / 255]);
        value = '22 18 14'; expect(m.canvasBackground3dUnit()).toEqual([9 / 255, 12 / 255, 13 / 255]); // cached until the theme changes
        handlers.forEach(f => f()); expect(m.canvasBackground3dUnit()).toEqual([22 / 255, 18 / 255, 14 / 255]);
        value = 'garbage'; handlers.forEach(f => f()); expect(m.canvasBackground3dUnit()).toEqual(m.DEFAULT_CANVAS_BG_3D);
      } finally { globalThis.document = saved.d; globalThis.getComputedStyle = saved.g; }
    });
  });
  it('theme.js tells the canvas code about a theme change, and scene-view.js draws the 3D view again', () => {
    expect(read('docs/theme.js')).toContain("new CustomEvent('vrl-themechange'");
    expect(read('docs/scene-view.js')).toMatch(/onCanvasThemeChange\(\(\)=>\{applyThemeBackground\(\);request3DRender\(\)\}\)/);
  });
  it('canvas-theme.js reads only the background variable', () => {
    const ct = read('docs/canvas-theme.js').replace(/\/\/[^\n]*/g, '');
    expect(ct).toMatch(/--ui-canvas-bg-3d/); expect(ct).not.toMatch(/--ui-(?!canvas-bg)/);
    expect(ct).not.toMatch(/getContext|canvas\.width|ImageData|windowCenter|segment/);
    expect(read('docs/scene-view.js')).toMatch(/applyThemeBackground=\(\)=>\{if\(backend==='WEBGL'\)\{const c=canvasBackground3d\(\);if\(c\)renderer\.setClearColor\(/);
  });
  it('the code that makes the image (grey levels, window / level, segments, volume transfer function) knows nothing about themes', () => {
    for (const f of ['mpr-render', 'mpr3d-overlay', 'mpr-orthogonal', 'segments', 'segment-runs', 'scene3d', 'surface-build', 'surface-mesh', 'gpu-shaders', 'gpu-compute', 'volume-io', 'vr-view', 'section-view', 'cpu-filters', 'source-filters', 'filter-units']) {
      const t = read('docs/' + f + '.js');
      expect(t, f).not.toMatch(/data-theme|themeMode|theme\.js|theme-ui|canvas-theme|--ui-|getComputedStyle/);
    }
    // the only drawing code that imports canvas-theme.js: scene-view.js (clear colour) and medical-volume.js (background uniform)
    const users = ['scene-view', 'medical-volume'].filter(f => read('docs/' + f + '.js').includes('canvas-theme.js'));
    expect(users).toEqual(['scene-view', 'medical-volume']);
    const sv = read('docs/scene-view.js'); expect(sv.match(/--ui-/g)).toBeNull(); expect(sv).not.toMatch(/data-theme|themeMode|theme-ui|from '\.\/theme\.js/);
    // the theme code touches only <html> attributes, the theme-color meta and one event
    const th = (read('docs/theme.js') + read('docs/theme-ui.js')).replace(/\/\/[^\n]*/g, ''); // code, not comments
    expect(th).not.toMatch(/canvas|getContext|WebGL|gpu|segment|window.?level|windowCenter/i);
  });
  it('segment preset colours are data, not theme colours', () => {
    const seg = read('docs/segments.js');
    for (const c of ['#f3f0e8', '#d97f7f', '#e7c85d', '#6fb8d6']) expect(seg).toContain(c);
  });
  it('annotations drawn over the 3D view have a dark outline, so they read on any background', () => {
    const sv = read('docs/scene-view.js');
    expect(sv).toContain("ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle='#00e5ff'"); // cut / lasso stroke
    expect(sv).toMatch(/pivotIndicator\.style,\{[^}]*boxShadow:'0 0 0 1px rgba\(0,0,0/);
    expect(sv).toMatch(/ctx\.strokeStyle='rgba\(0,0,0,\.85\)';ctx\.strokeText\(label/); // axis letters
    expect(read('docs/mpr3d-overlay.js')).toMatch(/ctx\.strokeStyle='rgba\(0,0,0,\.9\)';ctx\.strokeText\(text/); // plane labels
  });
});

describe('colours left as literals in style.css are the intended ones', () => {
  it('only overlay scrims, shadows, spinners and image-area colours stay literal', () => {
    const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const lits = new Set([...css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)].map(m => m[0].toLowerCase().replace(/\s/g, '')).filter(x => !/^rgba?\(var/.test(x)));
    const allowed = ['#fff', '#ffe27a', '#111', 'rgba(255,255,255,.9)', 'rgba(255,210,61,.85)', '#0a84ff', '#3d8bfd', '#00b8d4', '#9bd7ee', 'rgba(5,8,10,.28)', 'rgba(5,8,10,.54)', 'rgba(5,8,10,.55)', 'rgba(93,141,255,.24)', 'rgba(0,229,255,.8)', 'rgba(0,229,255,.45)', 'rgba(255,255,255,.2)', 'rgba(255,255,255,.22)', 'rgba(255,255,255,.42)', 'rgba(255,255,255,.08)', 'rgba(105,184,216,.18)', 'rgba(128,128,128,.45)', '#0b6f8c', '#4dd8ff', '#04202a' /* 3D point dots: the VR point colours, the same on every theme */, '#ffd23d', 'rgba(255,210,61,.7)', 'rgba(17,23,27,.88)' /* distances: the VR selection yellow and its dark label, the same on every theme */, '#e8508f', 'rgba(232,80,143,.55)', 'rgba(232,80,143,0)' /* the tutorial pink (the event slides' accent, the VR board's pointer), the same on every theme */];
    const extra = [...lits].filter(x => !allowed.includes(x) && !/^rgba\(0,0,0,[\d.]+\)$/.test(x) && !/^rgba\((118,141,151|110,130,140|216,230,236),[\d.]+\)$/.test(x));
    expect(extra).toEqual([]);
  });
});
