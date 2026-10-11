/**
 * Architecture rules (docs/architecture.md): package layers and environments.
 * Run: npx depcruise packages --config tools/depcruise.cjs
 */
const pkg = (name) => `^packages/${name}/`;
const env = (name) => `/${name}/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---- Layers: dependencies only go down ----
    { name: 'base-is-bottom', severity: 'error', comment: 'base imports nothing from other packages',
      from: { path: pkg('base') }, to: { path: '^packages/(?!base/)' } },
    { name: 'contracts-only-base', severity: 'error', comment: 'contracts may import only base',
      from: { path: pkg('contracts') }, to: { path: '^packages/(?!(base|contracts)/)' } },
    { name: 'platform-not-up', severity: 'error', comment: 'platform never imports UI or entry points',
      from: { path: pkg('platform') }, to: { path: '^packages/(workbench|app|cli|mcp)/' } },
    { name: 'workbench-no-platform', severity: 'error', comment: 'the UI reaches services only via window.orch',
      from: { path: pkg('workbench') }, to: { path: '^packages/(platform|app|cli|mcp)/' } },
    { name: 'cli-mcp-limited', severity: 'error', comment: 'cli/mcp use contracts and the channel client only',
      from: { path: '^packages/(cli|mcp)/' }, to: { path: '^packages/(workbench|app)/|^packages/platform/(?!src/channels/common/)' } },
    { name: 'nothing-imports-entrypoints', severity: 'error',
      from: { pathNot: '^packages/(app|cli|mcp)/' }, to: { path: '^packages/(app|cli|mcp)/' } },

    // ---- Environments (VS Code rules) ----
    { name: 'common-is-pure', severity: 'error', comment: 'common may import only common',
      from: { path: env('common') }, to: { path: '/(browser|node|electron-[a-z]+)/' } },
    { name: 'common-no-node-builtins', severity: 'error',
      from: { path: env('common') }, to: { dependencyTypes: ['core'] } },
    { name: 'browser-not-node', severity: 'error',
      from: { path: env('browser') }, to: { path: '/(node|electron-main|electron-utility)/' } },
    { name: 'browser-no-node-builtins', severity: 'error',
      from: { path: env('browser') }, to: { dependencyTypes: ['core'] } },
    { name: 'node-not-ui', severity: 'error',
      from: { path: env('node') }, to: { path: '/(browser|electron-[a-z]+)/' } },
    { name: 'preload-only-common', severity: 'error',
      from: { path: env('electron-preload') }, to: { path: '/(browser|node|electron-main|electron-utility)/' } },
    { name: 'utility-not-main-or-ui', severity: 'error',
      from: { path: env('electron-utility') }, to: { path: '/(browser|electron-main|electron-preload)/' } },

    // ---- Workbench contrib rules (VS Code) ----
    { name: 'no-imports-into-contrib', severity: 'error', comment: 'only workbench.main.ts loads contributions',
      from: { path: '^packages/workbench/src/browser/(?!contrib/|workbench\\.main\\.ts)' },
      to: { path: '^packages/workbench/src/browser/contrib/' } },
    { name: 'contrib-public-api-only', severity: 'error', comment: 'other areas may import only contrib/<area>/index.ts',
      from: { path: '^packages/workbench/src/browser/contrib/([^/]+)/' },
      to: { path: '^packages/workbench/src/browser/contrib/(?!$1/)[^/]+/(?!index\\.tsx?$)' } },

    // ---- Who may touch dangerous modules ----
    { name: 'only-engine-imports-claw', severity: 'error',
      from: { pathNot: '^packages/platform/src/engine/node/' }, to: { path: 'claw-orchestrator' } },
    { name: 'only-adapters-shells-git-spawn', severity: 'error', comment: 'process spawning is limited to adapters, git, shells and engine host',
      from: { pathNot: '^packages/platform/src/(adapters|git|shells|engine)/node/|^packages/app/' },
      to: { path: '^(child_process|execa|node-pty)$|node_modules/(execa|node-pty)/' } },

    // ---- Hygiene ----
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
