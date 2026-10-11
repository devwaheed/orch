/**
 * electron-builder configuration for orch (S5-01).
 * References:
 * - LOCKED PRD-01 (productName: orch)
 * - LOCKED PRD-02 (macOS 13+ universal, Windows 11 x64, Linux x64)
 * - LOCKED REL-01 (semver, beta channel)
 * - LOCKED REL-03 (.dmg universal, .exe NSIS, AppImage and .deb; signed macOS & Windows)
 */

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.orch.app',
  productName: 'orch',
  directories: {
    output: 'dist/release',
    buildResources: 'build',
  },
  files: [
    'dist/**/*',
    '!dist/release/**/*',
    'package.json',
  ],
  extraResources: [
    {
      from: '../workbench/dist',
      to: 'workbench/dist',
      filter: ['**/*'],
    },
  ],
  asarUnpack: [
    '**/node_modules/node-pty/**/*',
  ],
  afterPack: async (context) => {
    const fs = require('node:fs');
    const path = require('node:path');
    function makeSpawnHelpersExecutable(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          makeSpawnHelpersExecutable(fullPath);
        } else if (entry.name === 'spawn-helper') {
          try {
            fs.chmodSync(fullPath, 0o755);
            console.log(`[afterPack] chmod 755: ${fullPath}`);
          } catch (err) {
            console.warn(`[afterPack] Failed to chmod ${fullPath}:`, err);
          }
        }
      }
    }
    makeSpawnHelpersExecutable(context.appOutDir);
  },
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['universal'],
      },
    ],
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    // S5-02 signing / notarization env-var placeholders:
    ...(process.env.APPLE_IDENTITY ? { identity: process.env.APPLE_IDENTITY } : {}),
    ...(process.env.APPLE_ID
      ? {
          notarize: {
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  },
  dmg: {
    title: '${productName} ${version}',
    contents: [
      {
        x: 130,
        y: 220,
      },
      {
        x: 410,
        y: 220,
        type: 'link',
        path: '/Applications',
      },
    ],
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    // S5-02 Windows signing env-var placeholders:
    ...(process.env.WIN_CSC_LINK
      ? {
          cscLink: process.env.WIN_CSC_LINK,
          cscKeyPassword: process.env.WIN_CSC_KEY_PASSWORD,
        }
      : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
      {
        target: 'deb',
        arch: ['x64'],
      },
    ],
    category: 'Development',
  },
  deb: {
    depends: ['gconf2', 'gconf-service', 'libnotify4', 'libappindicator1', 'libxtst6', 'libnss3'],
  },
};
