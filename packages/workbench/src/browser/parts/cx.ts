/** Joins class names, skipping the empty ones (same helper as contrib/specs/components/cx.ts). */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}
