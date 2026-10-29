/**
 * SEC-02 rules for the window that do not need Electron: which addresses the
 * window may show, and which links may leave the app. Kept pure so the tests run
 * in plain Node.
 */
import { pathToFileURL } from 'node:url';

/** True when `url` is the bundled page itself (no remote content, no other local files). */
export function isBundledPage(url: string, pagePath: string): boolean {
  const page = pathToFileURL(pagePath).href;
  try {
    const target = new URL(url);
    const current = new URL(page);
    return target.protocol === 'file:' && target.pathname === current.pathname;
  } catch {
    return false;
  }
}

/** SEC-02: external links open in the system browser, and only web links do. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** OS-open may launch a web URL or a local file URL only. */
export function isSafeOpenPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'file:';
  } catch {
    return false;
  }
}
