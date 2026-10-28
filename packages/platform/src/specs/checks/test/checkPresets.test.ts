/**
 * New spec check presets: one fixture repo per supported ecosystem, plus the
 * lockfile and Makefile rules the fixtures cannot cover on their own.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectCheckPresets, type RepoCheckFiles } from '../common/checkPresets.js';
import { readRepoCheckPresets } from '../node/readCheckPresets.js';

const EMPTY: RepoCheckFiles = {
  packageJson: null,
  lockfiles: [],
  pyprojectToml: null,
  pytestIni: null,
  cargoToml: null,
  goMod: null,
  makefile: null,
};

function files(overrides: Partial<RepoCheckFiles>): RepoCheckFiles {
  return { ...EMPTY, ...overrides };
}

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../../test/fixtures/repo-checks/${name}`, import.meta.url));
}

const FIXTURES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['node-npm', ['npm test', 'npm run lint', 'npm run typecheck', 'npm run build']],
  ['node-pnpm', ['pnpm test', 'pnpm lint', 'pnpm typecheck', 'pnpm build']],
  ['node-yarn', ['yarn test', 'yarn lint']],
  ['node-bun', ['bun run test', 'bun run build']],
  ['python-pyproject', ['pytest']],
  ['python-pytest', ['pytest']],
  ['rust', ['cargo test']],
  ['go', ['go test ./...']],
  ['make', ['make test']],
  ['make-no-test', []],
];

describe('readRepoCheckPresets', () => {
  for (const [name, expected] of FIXTURES) {
    it(`detects ${name}`, async () => {
      expect(await readRepoCheckPresets(fixture(name))).toEqual(expected);
    });
  }

  it('returns no presets for a folder with no known ecosystem', async () => {
    expect(await readRepoCheckPresets(fixture('no-ecosystem'))).toEqual([]);
  });
});

describe('detectCheckPresets', () => {
  const packageJson = JSON.stringify({ scripts: { test: 'vitest run' } });

  it('prefers pnpm, then yarn, then bun, else npm, from the lockfile', () => {
    expect(detectCheckPresets(files({ packageJson, lockfiles: ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'] }))).toEqual(['pnpm test']);
    expect(detectCheckPresets(files({ packageJson, lockfiles: ['yarn.lock', 'bun.lockb'] }))).toEqual(['yarn test']);
    expect(detectCheckPresets(files({ packageJson, lockfiles: ['bun.lockb'] }))).toEqual(['bun run test']);
    expect(detectCheckPresets(files({ packageJson }))).toEqual(['npm test']);
  });

  it('keeps the script order and ignores scripts that are not offered', () => {
    const all = JSON.stringify({
      scripts: { build: 'x', lint: 'x', typecheck: 'x', test: 'x', deploy: 'x' },
    });
    expect(detectCheckPresets(files({ packageJson: all, lockfiles: ['pnpm-lock.yaml'] }))).toEqual([
      'pnpm test',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm build',
    ]);
    expect(detectCheckPresets(files({ packageJson: JSON.stringify({ scripts: { deploy: 'x' } }) }))).toEqual([]);
  });

  it('ignores a package.json that is not valid JSON', () => {
    expect(detectCheckPresets(files({ packageJson: '{' }))).toEqual([]);
  });

  it('needs a real Makefile test target, not a variable named test', () => {
    expect(detectCheckPresets(files({ makefile: 'test := 1\n' }))).toEqual([]);
    expect(detectCheckPresets(files({ makefile: '.PHONY: test\ntest: build\n\t./run-tests\n' }))).toEqual(['make test']);
  });
});
