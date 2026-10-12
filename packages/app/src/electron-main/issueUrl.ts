/**
 * Builds the GitHub new issue URL with prefilled system information.
 * Uses the owner and repo from the release feed.
 */
import type { UpdateFeed } from './updates/updater.js';

export interface NewIssueOptions {
  readonly feed: UpdateFeed;
  readonly version: string;
  readonly os: string;
}

export function buildNewIssueUrl(options: NewIssueOptions): string {
  const { feed, version, os } = options;
  const owner = feed.owner;
  const repo = feed.repo;
  const body = `orch version: ${version}\nOS: ${os}`;
  return `https://github.com/${owner}/${repo}/issues/new?body=${encodeURIComponent(body)}`;
}
