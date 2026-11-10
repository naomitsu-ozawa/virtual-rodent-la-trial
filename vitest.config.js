import { defineConfig } from 'vitest/config';

// The app imports its third-party libraries from the vendored copies under docs/vendor/<package>@<version>/ (see top of
// docs/app.js and docs/medical-volume.js; tools/vendor-libs.mjs builds them). For Node-side tests, map those exact import
// specifiers to the same pinned versions from npm (devDependencies): one three.js core instance for the tests and the docs modules.
// Keep these versions in sync with docs/vendor (tools/vendor-libs.mjs).
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
      { find: './vendor/three@0.186.0/build/three.webgpu.js', replacement: 'three/webgpu' },
      { find: './vendor/three@0.186.0/build/three.module.js', replacement: 'three' },
      { find: './vendor/dicom-parser@1.8.21/index.js', replacement: 'dicom-parser' },
      { find: './vendor/fflate@0.8.2/index.js', replacement: 'fflate' },
    ],
  },
  test: {
    include: ['tests/static/**/*.test.js', 'tests/unit/**/*.test.js', 'tests/tools/**/*.test.js'],
    environment: 'node',
    setupFiles: ['tests/setup/registry.js'], // the practice-data registry, filled from the docs/demo/sampleN/sample.json files
  },
});
