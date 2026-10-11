/**
 * The GitHub Releases feed for auto-update (S5-03, REL-02).
 *
 * electron-builder's `publish` config is the source of truth: when it names a
 * GitHub owner and repo, that feed is used. `electron-builder.config.cjs` has no
 * `publish` block today, so the clearly marked fallback below is used instead.
 */
import type { UpdateFeed } from './updater.js';

/** A `require`-shaped function; `createRequire` from `node:module` provides the real one. */
export type PublishConfigLoader = (path: string) => unknown;

/**
 * OWNER QUESTION (S5-03): the GitHub owner/repo that publishes orch releases is
 * not decided, and `electron-builder.config.cjs` has no `publish` block. Replace
 * both placeholders once the release repository exists. Until then the packaged
 * app will find no releases, which is the intended safe behaviour.
 */
export const ORCH_RELEASES: UpdateFeed = {
  provider: 'github',
  owner: 'OWNER_NOT_DECIDED',
  repo: 'REPO_NOT_DECIDED',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads a GitHub feed out of electron-builder's `publish` config. `publish` may
 * be one object or an array of them; only an entry that names the `github`
 * provider with a string `owner` and `repo` is accepted. Anything else is `null`
 * so the caller falls back to `ORCH_RELEASES`.
 */
export function githubFeedFromPublishConfig(publish: unknown): UpdateFeed | null {
  const entries = Array.isArray(publish) ? publish : publish ? [publish] : [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const { provider, owner, repo } = entry;
    if (provider === 'github' && typeof owner === 'string' && owner.length > 0 && typeof repo === 'string' && repo.length > 0) {
      return { provider: 'github', owner, repo };
    }
  }
  return null;
}

/**
 * Loads electron-builder's config file and returns its `publish` value, or
 * `undefined` when the file is missing (the packaged app does not ship it) or
 * cannot be read. Never throws.
 */
export function loadPublishConfig(requireFrom: PublishConfigLoader, configPath: string): unknown {
  try {
    const loaded = requireFrom(configPath);
    return isRecord(loaded) ? loaded['publish'] : undefined;
  } catch {
    return undefined;
  }
}
