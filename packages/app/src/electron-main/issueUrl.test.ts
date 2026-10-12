import { describe, expect, it } from 'vitest';
import { buildNewIssueUrl } from './issueUrl.js';
import { ORCH_RELEASES } from './updates/feed.js';

describe('buildNewIssueUrl (BUG-04)', () => {
  it('builds https://github.com/<owner>/<repo>/issues/new with encoded version and OS', () => {
    const url = buildNewIssueUrl({
      feed: ORCH_RELEASES,
      version: '1.2.3',
      os: 'macos',
    });
    expect(url).toBe(
      'https://github.com/OWNER_NOT_DECIDED/REPO_NOT_DECIDED/issues/new?body=orch%20version%3A%201.2.3%0AOS%3A%20macos',
    );
  });

  it('uses configured feed owner and repo when supplied', () => {
    const url = buildNewIssueUrl({
      feed: { provider: 'github', owner: 'orchagents', repo: 'orch' },
      version: '0.9.0',
      os: 'linux',
    });
    expect(url).toBe(
      'https://github.com/orchagents/orch/issues/new?body=orch%20version%3A%200.9.0%0AOS%3A%20linux',
    );
  });
});
