// A do-nothing DOM for importing the app's stateful modules (segments.js pulls in ui-shell.js, which builds the page
// at import time) in a Node unit test: every property read, call and construction answers with the same inert proxy.
import { vi } from 'vitest';
export function installDomStub() {
  const make = () => {
    const p = new Proxy(function () {}, {
      get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? function* () {} : k === 'then' ? undefined : p),
      apply: () => p, construct: () => p, set: () => true, has: () => true,
    });
    return p;
  };
  const d = make();
  vi.stubGlobal('document', d);
  vi.stubGlobal('window', d);
  vi.stubGlobal('navigator', { maxTouchPoints: 0, gpu: undefined, userAgent: 'node' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal('location', { search: '', href: 'http://localhost/' });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, addListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', f => setTimeout(f, 0));
}

// The app modules import each other as './x.js?v=<date>-build<N>'; Vite treats that as a different module from plain
// './x.js', so a test must import them with the very same query to share their state (segmentState, edit state, ...).
import { readFileSync } from 'node:fs';
const versionQuery = readFileSync(new URL('../../docs/segment-runs.js', import.meta.url), 'utf8').match(/\.\/segments\.js(\?v=[^']+)/)[1];
export const importApp = name => import(/* @vite-ignore */ '../../docs/' + name + '.js' + versionQuery);
