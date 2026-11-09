import { defineConfig } from 'vitest/config';

// The app imports its dependencies straight from CDNs (see top of docs/app.js
// and docs/medical-volume.js). For Node-side tests, map those exact URLs to the
// same pinned versions from npm so modules can be imported without network.
// Keep these versions in sync with the CDN URLs.
// The docs modules import each other with a cache-busting query (./x.js?v=BUILD): Vite would make that a second instance of the module next to the one the tests import.
// The practice-data registry is one shared state (tests/setup/registry.js fills it) and it adds its texts to the I18N table and hands the known ids to sample-sets.js, so the query of these three modules is dropped here: one instance for the tests and for every docs module.
const oneRegistryInstance = {
  name: 'one-registry-instance',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const m = /^(.*(?:sample-registry|sample-sets|i18n)\.js)\?v=\d{8}-build[\w.-]*$/.exec(source);
    return m ? this.resolve(m[1], importer, { ...options, skipSelf: true }) : null;
  },
};
export default defineConfig({
  plugins: [oneRegistryInstance],
  resolve: {
    alias: [
      { find: 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js', replacement: 'three/webgpu' },
      { find: 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js', replacement: 'three' },
      { find: 'https://esm.sh/dicom-parser@1.8.21', replacement: 'dicom-parser' },
      { find: 'https://esm.sh/fflate@0.8.2', replacement: 'fflate' },
    ],
  },
  test: {
    include: ['tests/static/**/*.test.js', 'tests/unit/**/*.test.js', 'tests/tools/**/*.test.js'],
    environment: 'node',
    setupFiles: ['tests/setup/registry.js'], // the practice-data registry, filled from the docs/demo/sampleN/sample.json files
  },
});
