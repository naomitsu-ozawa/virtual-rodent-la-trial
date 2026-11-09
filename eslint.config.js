import globals from 'globals';

// Guardrail for refactoring docs/*.js: catches references to names that no
// longer exist after code moves between modules (no-undef), broken imports
// and duplicate declarations. Intentionally minimal — not a style linter.
export default [
  { ignores: ['docs/vendor/**'] }, // third-party code (tools/vendor-libs.mjs), not linted
  {
    files: ['docs/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-import-assign': 'error',
      'no-const-assign': 'error',
      'no-func-assign': 'error',
      'no-class-assign': 'error',
    },
  },
];
