import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/.open-next/**',
      '**/.turbo/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'supabase/.temp/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended
);
