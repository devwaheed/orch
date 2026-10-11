// Architecture rules that dependency-cruiser can't express.
// Spread into the root eslint.config.mjs.
export default [
  {
    files: ['packages/**/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error', {
        object: 'process', property: 'env',
        message: 'Read environment through IEnvironmentService. Only platform/profiles builds account env.',
      }],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.name='require']", message: 'Use ESM imports.' },
      ],
    },
  },
  {
    // The two places allowed to read process.env
    files: ['packages/platform/src/profiles/node/**', 'packages/app/src/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
