/** Adds the login-shell PATH passed by Electron main to the core host environment. */
export function coreHostEnv(
  baseEnv: Readonly<Record<string, string>>,
  args: readonly string[],
): Record<string, string> {
  const result = { ...baseEnv };
  const index = args.indexOf('--orch-resolved-path');
  const resolvedPath = index >= 0 ? args[index + 1] : undefined;
  if (resolvedPath !== undefined) {
    const pathKey = Object.keys(result).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    result[pathKey] = resolvedPath;
  }
  return result;
}
