/**
 * Pure logic for extracting BMAD story details and generating front-matter skeletons.
 * docs/specs/spec-queue.md §2:
 * "orch specs init adds a front-matter skeleton to each story that lacks one:
 * id and title from the story, one audit criterion per acceptance-criteria list item,
 * empty depends_on and scope. The user reviews these before starting."
 */

export interface ParsedBmadStory {
  readonly id: string;
  readonly title: string;
  readonly criteria: readonly string[];
}

/**
 * Checks whether markdown content starts with a YAML front-matter block.
 */
export function hasFrontMatter(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return false;
  }
  const afterFirst = trimmed.slice(3);
  return afterFirst.search(/^---$/m) !== -1;
}

/**
 * Parses a BMAD story markdown file to extract its ID, title, and acceptance criteria.
 */
export function parseBmadStory(markdown: string, fileName?: string): ParsedBmadStory {
  const lines = markdown.split(/\r?\n/);

  let extractedId: string | null = null;
  let extractedTitle: string | null = null;

  // 1. Look for top-level heading: # ...
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      const headingText = trimmed.slice(2).trim();

      // Check patterns like:
      // "# Story 42: Callback flow"
      // "# 42 - Integration tests"
      // "# S42: Integration tests"
      // "# [42] Integration tests"
      // "# 42. Integration tests"
      const matchWithId = headingText.match(/^(?:Story\s+|S\s*)?\[?(\d{1,4})\]?[\s:.\-]+(.*)$/i);
      if (matchWithId && matchWithId[1]) {
        extractedId = String(parseInt(matchWithId[1], 10));
        const rest = matchWithId[2]?.trim() ?? '';
        if (rest.length > 0) {
          extractedTitle = rest;
        }
      } else {
        extractedTitle = headingText;
      }
      break;
    }
  }

  // 2. If ID was not found in heading, attempt to extract digits from filename
  if (!extractedId && fileName) {
    const fileBase = fileName.replace(/\.md$/, '');
    const numMatch = fileBase.match(/^(?:story[-_])?(\d{1,4})/i);
    if (numMatch && numMatch[1]) {
      extractedId = String(parseInt(numMatch[1], 10));
    }
  }

  const finalId = extractedId ?? '1';

  // 3. Fallback title from filename if heading was absent
  if (!extractedTitle && fileName) {
    const cleanName = fileName
      .replace(/\.md$/, '')
      .replace(/^\d+[-_]/, '')
      .replaceAll('-', ' ')
      .replaceAll('_', ' ')
      .trim();
    extractedTitle = cleanName.length > 0 ? cleanName : `Story ${finalId}`;
  }
  const finalTitle = (extractedTitle ?? `Story ${finalId}`).slice(0, 120);

  // 4. Extract acceptance criteria
  const criteria: string[] = [];
  let inCriteriaSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#{2,4}\s+Acceptance\s+Criteria\b/i.test(trimmed)) {
      inCriteriaSection = true;
      continue;
    }

    if (inCriteriaSection) {
      // If we encounter another heading, exit the section
      if (/^#{1,4}\s+/.test(trimmed)) {
        break;
      }

      // Check for list items:
      // "- [ ] Criterion" or "- [x] Criterion" or "- Criterion" or "* Criterion" or "1. Criterion"
      const itemMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s*)?(.+)$/);
      if (itemMatch && itemMatch[1]) {
        const itemText = itemMatch[1].trim();
        if (itemText.length > 0) {
          criteria.push(itemText);
        }
      }
    }
  }

  // At least one done_when criterion is required by the SpecFile schema
  const finalCriteria = criteria.length > 0 ? criteria : [`Verify ${finalTitle}`];

  return {
    id: finalId,
    title: finalTitle,
    criteria: finalCriteria,
  };
}

/**
 * Generates the front-matter skeleton YAML block.
 */
export function formatBmadFrontMatter(story: {
  readonly id: string;
  readonly title: string;
  readonly criteria: readonly string[];
}): string {
  const lines: string[] = [
    '---',
    `id: ${JSON.stringify(story.id)}`,
    `title: ${JSON.stringify(story.title)}`,
    'depends_on: []',
    'scope: []',
    'done_when:',
  ];

  for (const criterion of story.criteria) {
    lines.push('  - by: audit');
    lines.push(`    text: ${JSON.stringify(criterion)}`);
  }

  lines.push('---');
  return lines.join('\n');
}
