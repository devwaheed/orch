import { describe, expect, it } from 'vitest';
import { ORCH_RELEASES, githubFeedFromPublishConfig, loadPublishConfig } from './feed.js';

describe('S5-03 release feed', () => {
  it('reads a GitHub feed from a single publish object', () => {
    expect(githubFeedFromPublishConfig({ provider: 'github', owner: 'orch', repo: 'orch' })).toEqual({
      provider: 'github',
      owner: 'orch',
      repo: 'orch',
    });
  });

  it('reads a GitHub feed from a publish array', () => {
    expect(
      githubFeedFromPublishConfig([
        { provider: 'generic', url: 'https://example.com' },
        { provider: 'github', owner: 'orch', repo: 'releases' },
      ]),
    ).toEqual({ provider: 'github', owner: 'orch', repo: 'releases' });
  });

  it('returns null when there is no usable GitHub feed', () => {
    expect(githubFeedFromPublishConfig(undefined)).toBeNull();
    expect(githubFeedFromPublishConfig([])).toBeNull();
    expect(githubFeedFromPublishConfig({ provider: 'generic', url: 'https://example.com' })).toBeNull();
    expect(githubFeedFromPublishConfig({ provider: 'github', owner: 'orch' })).toBeNull();
    expect(githubFeedFromPublishConfig({ provider: 'github', repo: '' })).toBeNull();
  });

  it('leaves a clearly marked fallback when no publish config exists', () => {
    expect(ORCH_RELEASES).toEqual({ provider: 'github', owner: 'OWNER_NOT_DECIDED', repo: 'REPO_NOT_DECIDED' });
    expect(githubFeedFromPublishConfig(loadPublishConfig(() => ({}), '/nowhere/config.cjs'))).toBeNull();
  });

  it('loads the publish field from a config file, and never throws', () => {
    const publish = [{ provider: 'github', owner: 'orch', repo: 'orch' }];
    expect(loadPublishConfig(() => ({ publish }), '/app/electron-builder.config.cjs')).toBe(publish);
    expect(loadPublishConfig(() => ({ name: 'orch' }), '/app/electron-builder.config.cjs')).toBeUndefined();
    expect(
      loadPublishConfig(() => {
        throw new Error('module not found');
      }, '/missing/electron-builder.config.cjs'),
    ).toBeUndefined();
  });
});
