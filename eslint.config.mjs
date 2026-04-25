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
  },
  // Phase 1.4 (hardening): chokepoint enforcement.
  // Block direct `UPDATE patients SET status_key` writes everywhere except the helper itself.
  // The DB trigger is the runtime backstop; this rule catches violations at code-review time.
  {
    files: ['app/**/*.{js,ts,tsx}', 'lib/**/*.{js,ts,tsx}', 'scripts/**/*.{js,ts,tsx}'],
    ignores: ['lib/status-transitions.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "Literal[value=/UPDATE\\s+patients\\s+SET\\s+(\\w+\\s*=\\s*[^,]+,\\s*)*status_key/i]",
          message: 'Direct status_key writes are forbidden. Use transitionStatus() from lib/status-transitions.ts. The DB trigger will reject rule violations even if this rule is bypassed.'
        },
        {
          selector: "TemplateElement[value.raw=/UPDATE\\s+patients\\s+SET\\s+(\\w+\\s*=\\s*[^,]+,\\s*)*status_key/i]",
          message: 'Direct status_key writes are forbidden. Use transitionStatus() from lib/status-transitions.ts. The DB trigger will reject rule violations even if this rule is bypassed.'
        }
      ]
    }
  }
];
