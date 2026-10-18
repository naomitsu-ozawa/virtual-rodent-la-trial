import { defineConfig } from 'vitest/config';

// The app imports its dependencies straight from CDNs (see top of docs/app.js
// and docs/medical-volume.js). For Node-side tests, map those exact URLs to the
// same pinned versions from npm so modules can be imported without network.
// Keep these versions in sync with the CDN URLs.
export default defineConfig({
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
  },
});
