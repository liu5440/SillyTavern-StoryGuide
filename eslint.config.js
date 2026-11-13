import ts from 'typescript-eslint';
export default ts.config(...ts.configs.recommended, {
  files: ['src/**/*.ts', 'tests/**/*.ts'],
  rules: { '@typescript-eslint/no-explicit-any': 'error' },
});
