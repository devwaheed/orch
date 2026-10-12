/**
 * Pure path formatting helpers for display.
 * Works without Node across POSIX and Windows path styles.
 */

/**
 * Normalizes backslashes to forward slashes for prefix comparison while preserving case.
 * Also handles Windows drive letter comparison case-insensitively if needed,
 * but primarily ensures path separators don't mismatch.
 */
function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Formats a project path to be relative to the user's home folder (e.g. ~/code/api-server).
 * If the path is not under the home directory, the original path is returned.
 * Works for POSIX (/Users/me/code) and Windows (C:\Users\me\code) paths.
 * Does not replace mere prefix matches (/Users/me2 is not under /Users/me).
 */
export function formatProjectPath(path: string, home: string): string {
  if (!path || !home) return path;

  // Trim trailing separators from home for clean comparison
  const cleanHome = home.replace(/[\\/]+$/, '');
  if (!cleanHome) return path;

  const sep = path.includes('\\') ? '\\' : '/';

  // Compare case-insensitively on Windows (e.g. C:\Users\... vs c:\users\...)
  // But preserve the casing in relative remainder
  const normPath = normalizeSlashes(path);
  const normHome = normalizeSlashes(cleanHome);

  const isWindows = /^[a-zA-Z]:/.test(cleanHome) || /^[a-zA-Z]:/.test(path);

  const match = isWindows
    ? normPath.toLowerCase() === normHome.toLowerCase() ||
      normPath.toLowerCase().startsWith(normHome.toLowerCase() + '/')
    : normPath === normHome || normPath.startsWith(normHome + '/');

  if (!match) return path;

  if (normPath.length === normHome.length) {
    return '~';
  }

  const remainder = path.slice(cleanHome.length).replace(/^[\\/]+/, '');
  return `~${sep}${remainder}`;
}
