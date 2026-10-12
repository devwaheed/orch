/**
 * Turns accounts.yaml text into a validated AccountsFile. Syntax errors and
 * schema errors both come back as field-level errors with 1-based line numbers.
 */
import { err, ok } from '@orchagents/base';
import { AccountsFile, type OrchError, type Result } from '@orchagents/contracts';
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document } from 'yaml';
import { fieldPath, type ConfigFieldError, type ConfigSnapshot } from '../common/config.js';

const FILE_NAME = 'accounts.yaml';

type SchemaIssue = Extract<ReturnType<typeof AccountsFile.safeParse>, { success: false }>['error']['issues'][number];

/** Builds the `validation_failed` error that carries every field error. */
export function validationError(fields: readonly ConfigFieldError[]): OrchError {
  const [first] = fields;
  const where = first ? describe(first) : '';
  const message =
    fields.length > 1
      ? `${FILE_NAME} has ${fields.length} problems. First: ${where}`
      : `${FILE_NAME} has a problem: ${where}`;
  return {
    code: 'validation_failed',
    message,
    fix: 'Fix the lines listed and save the file again. orch keeps using the last valid config until then.',
    details: { fields: fields.map((field) => ({ ...field })) },
  };
}

function describe(field: ConfigFieldError): string {
  const line = field.line === null ? '' : `line ${field.line}, `;
  const path = field.path === '' ? '' : `${field.path}: `;
  return `${line}${path}${field.message}`;
}

/** Parses and validates the text. Never throws. */
export function parseAccountsYaml(text: string): Result<ConfigSnapshot> {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: true });

  if (doc.errors.length > 0) {
    return err(
      validationError(
        doc.errors.map((error) => ({
          path: '',
          line: error.linePos?.[0]?.line ?? null,
          message: firstLine(error.message),
        })),
      ),
    );
  }

  // An empty file means "all defaults". Any other top-level value goes through the schema.
  const raw: unknown = doc.contents === null ? {} : doc.toJS();
  const checked = AccountsFile.safeParse(raw);
  if (checked.success) {
    return ok({ text, parsed: checked.data });
  }

  const fields: ConfigFieldError[] = [];
  for (const issue of checked.error.issues) {
    for (const field of fieldsForIssue(issue)) {
      fields.push({
        path: fieldPath(field.path),
        line: lineFor(doc, lineCounter, field.path),
        message: issue.message,
      });
    }
  }
  fields.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return err(validationError(fields));
}

/** An unknown key is reported at the key itself, not at the object that holds it. */
function fieldsForIssue(issue: SchemaIssue): { path: readonly PropertyKey[] }[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({ path: [...issue.path, key] }));
  }
  return [{ path: issue.path }];
}

/** The first line of a yaml error, without the "at line N, column M" suffix (the field already has its line). */
function firstLine(message: string): string {
  const line = message.split('\n')[0]?.trim() ?? message;
  return line.replace(/ at line \d+, column \d+:?$/, '');
}

/**
 * Finds the line of the value at `path`. Walks the YAML tree along the path and
 * uses the key's line when the key exists, else the deepest node that does.
 */
export function lineFor(doc: Document, lineCounter: LineCounter, path: readonly PropertyKey[]): number | null {
  let node: unknown = doc.contents;
  let best: unknown = node;
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find((item) => {
        const key: unknown = isScalar(item.key) ? item.key.value : item.key;
        return String(key) === String(segment);
      });
      if (!pair) {
        break;
      }
      best = pair.key;
      node = pair.value;
    } else if (isSeq(node) && typeof segment === 'number') {
      node = node.items[segment];
      best = node;
    } else {
      break;
    }
  }
  const range = (best as { range?: readonly number[] } | null | undefined)?.range;
  const start = range?.[0];
  if (start === undefined) {
    return null;
  }
  return lineCounter.linePos(start).line;
}
