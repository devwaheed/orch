import tseslint from 'typescript-eslint';
import architectureRules from './tools/eslint.architecture.mjs';
import designRules from './design/lint/eslint.design.mjs';

const workbenchDesignRules = designRules.map((config) => ({
  ...config,
  files: config.files.map((pattern) =>
    pattern.includes('{ts,tsx}')
      ? `packages/workbench/${pattern.replace('{ts,tsx}', 'tsx')}`
      : `packages/workbench/${pattern}`
  ),
}));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.orch/**',
      '**/coverage/**',
      'spike/**',
      'packages/contracts/package-lock.json',
    ],
  },
  ...tseslint.configs.recommended,
  ...architectureRules,
  ...workbenchDesignRules,
);
