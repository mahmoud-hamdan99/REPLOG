// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * Architectural boundaries are enforced here, not by convention.
 * See docs/ARCHITECTURE.md section 3 (dependency rule) and section 12.2.
 */
module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'rl', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'rl', style: 'kebab-case' },
      ],
      // Features, core and shared depend on data/ interfaces — never on storage internals.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**'],
              message:
                'Depend on data/ repository interfaces and DI tokens, not on infrastructure. See docs/ARCHITECTURE.md section 3.',
            },
            {
              group: ['idb', 'idb/*'],
              message: 'Only src/app/infrastructure/idb may import idb.',
            },
          ],
        },
      ],
    },
  },

  // The infrastructure layer is the one place allowed to know about IndexedDB.
  {
    files: ['src/app/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**'],
              message: 'Infrastructure must not depend on features.',
            },
          ],
        },
      ],
    },
  },

  // The domain layer is pure TypeScript: no framework, no IO, no DOM.
  {
    files: ['src/app/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@angular/*', 'rxjs', 'rxjs/*', 'idb', 'idb/*'],
              message:
                'domain/ must stay pure TypeScript so it is testable without a browser. See docs/ARCHITECTURE.md section 6.',
            },
            {
              group: ['**/infrastructure/**', '**/data/**', '**/features/**', '**/core/**'],
              message: 'domain/ may only import from domain/.',
            },
          ],
        },
      ],
    },
  },

  // data/ declares interfaces; it must not reach for an implementation.
  {
    files: ['src/app/data/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**', '**/features/**'],
              message: 'data/ declares contracts only. Implementations live in infrastructure/.',
            },
          ],
        },
      ],
    },
  },

  // The composition root binds data/ contracts to their infrastructure
  // implementations. It is the single intended exception to the boundary above.
  {
    files: ['src/app/app.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
