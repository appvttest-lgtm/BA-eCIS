// Flat ESLint config: browser app code in src/, Node tooling everywhere else.
// Prettier owns formatting (eslint-config-prettier disables conflicting rules).
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // .claude/ can hold agent worktrees with their own dist builds; never lint them.
  { ignores: ['dist/', 'portable/', 'node_modules/', 'public/', '.claude/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    // 'latest' so the import attributes in src/carriers (`with { type: 'json' }`) parse.
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      // GS1 FNC1 group separators (\x1d etc.) are the domain: barcode payloads carry them.
      'no-control-regex': 'off',
      // Underscore prefix marks intentionally unused bindings (e.g. catch (_error)).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-key': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['server.mjs', 'vite.config.js', 'eslint.config.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } }
  },
  prettier
];
