import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';
import fsd from './scripts/fsd-rule.mjs';
export default [
  {
    ignores: [
      'node_modules/**',
      '.output/**',
      '.wxt/**',
      'dist/**',
      '_reference/**',
      '.ai-agent-playbook/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { '@typescript-eslint': tsPlugin, architecture: { rules: { fsd } } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'architecture/fsd': 'error',
    },
  },
  prettier,
];
