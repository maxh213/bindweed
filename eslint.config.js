import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    ignores: ['dist', 'coverage', 'node_modules', 'ts-coverage', 'qa', 'perf', 'reports', '.marestail', '.stryker-tmp', '.dependency-cruiser.cjs', 'test-results', 'playwright-report']
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'complexity': ['error', 4]
    }
  }
);
