import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { isBundledPage, isSafeExternalUrl, isSafeOpenPath } from './windowSecurity.js';

describe('SEC-02 window rules', () => {
  const page = '/app/dist/renderer/index.html';

  it('allows only the bundled page inside the window', () => {
    expect(isBundledPage(pathToFileURL(page).href, page)).toBe(true);
    expect(isBundledPage(pathToFileURL('/app/dist/other.html').href, page)).toBe(false);
    expect(isBundledPage('https://example.com/', page)).toBe(false);
    expect(isBundledPage('not a url', page)).toBe(false);
  });

  it('opens only web links in the system browser', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('orch-mcp-anything://x')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
  });

  it('allows the OS opener to receive web links and file URLs only', () => {
    expect(isSafeOpenPath('https://example.com')).toBe(true);
    expect(isSafeOpenPath('http://localhost')).toBe(true);
    expect(isSafeOpenPath('file:///Users/me/repo/index.html')).toBe(true);
    expect(isSafeOpenPath('javascript:alert(1)')).toBe(false);
    expect(isSafeOpenPath('/Users/me/repo/index.html')).toBe(false);
  });
});
