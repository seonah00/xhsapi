import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '.tmp/**', '.data/**', 'test-results/**', 'playwright-report/**', '**/next-env.d.ts'] },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // pg rows are untyped at the boundary; values are validated before use
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Raw HTML rendering is not allowed (XSS).' }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // Client bundles must not read server secrets.
    files: ['apps/web/src/components/**/*.tsx', 'apps/web/src/app/**/*-client.tsx'],
    rules: { 'no-restricted-properties': ['error', { object: 'process', property: 'env', message: 'No env access in client components.' }] },
  },
);
