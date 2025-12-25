import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Base ignores
const ignores = [
  '.next/**',
  'node_modules/**',
  'coverage/**',
  'dist/**',
  '**/*.css',
  '**/*.scss'
];

export default [
  { ignores },
  // JavaScript recommended rules with browser + Node globals
  {
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  // TypeScript recommended rules without type-checking for speed/compatibility
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ...config.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  })),
  // Next.js and React rules
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react/no-unescaped-entities': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
      'no-undef': 'off',
      'prefer-const': 'off',
      'no-unused-vars': 'off'
    }
  }
];
