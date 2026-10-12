/**
 * Reads and parses YAML front matter from spec markdown files.
 * Validates against SpecFile (packages/contracts/src/common/specs.ts).
 */
import { SpecFile, type SpecLoadProblem } from '@orchagents/contracts';
import { parseDocument } from 'yaml';
import { invalidFrontMatter } from '../common/problems.js';

export interface ParsedSpecFile {
  readonly spec: SpecFile;
  readonly body: string;
}

export type ParseSpecContentResult =
  | { readonly ok: true; readonly data: ParsedSpecFile }
  | { readonly ok: false; readonly problem: SpecLoadProblem };

export function parseSpecContent(content: string, filePath: string): ParseSpecContentResult {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return {
      ok: false,
      problem: invalidFrontMatter(filePath, 'missing front matter'),
    };
  }

  const afterFirst = trimmed.slice(3);
  const match = afterFirst.match(/^---$/m);
  if (!match || match.index === undefined) {
    return {
      ok: false,
      problem: invalidFrontMatter(filePath, 'unclosed front matter'),
    };
  }

  const frontMatterText = afterFirst.slice(0, match.index);
  const bodyText = afterFirst.slice(match.index + 3).trim();

  const doc = parseDocument(frontMatterText, { prettyErrors: true });
  if (doc.errors.length > 0) {
    const firstErr = doc.errors[0]?.message.split('\n')[0]?.trim() ?? 'YAML syntax error';
    return {
      ok: false,
      problem: invalidFrontMatter(filePath, firstErr),
    };
  }

  const raw: unknown = doc.contents === null ? {} : doc.toJS();
  const checked = SpecFile.safeParse(raw);
  if (!checked.success) {
    const firstIssue = checked.error.issues[0];
    let schemaError = 'schema validation failed';
    if (firstIssue) {
      if (firstIssue.code === 'unrecognized_keys') {
        schemaError = firstIssue.message;
      } else if (firstIssue.path.length > 0) {
        schemaError = `${firstIssue.path.join('.')}: ${firstIssue.message}`;
      } else {
        schemaError = firstIssue.message;
      }
    }
    return {
      ok: false,
      problem: invalidFrontMatter(filePath, schemaError),
    };
  }

  return {
    ok: true,
    data: {
      spec: checked.data,
      body: bodyText,
    },
  };
}
