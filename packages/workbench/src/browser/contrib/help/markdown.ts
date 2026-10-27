export type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlinePart[] }
  | { type: 'italic'; children: InlinePart[] }
  | { type: 'code'; children: InlinePart[] }
  | { type: 'link'; label: InlinePart[]; target: string; internal: boolean }
  | { type: 'image'; alt: string; path: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; id: string }
  | { type: 'paragraph'; children: InlinePart[] }
  | { type: 'list'; ordered: boolean; items: { children: InlinePart[]; nested?: { ordered: boolean; items: InlinePart[][] } }[] }
  | { type: 'code'; language: string; value: string }
  | { type: 'table'; rows: InlinePart[][][] }
  | { type: 'tip'; children: InlinePart[] }
  | { type: 'image'; alt: string; path: string }
  | { type: 'diagram'; name: string };

export function slugHeading(value: string): string {
  return value.toLowerCase().trim().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

function inline(source: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: 'text', value: source.slice(cursor, index) });
    if (match[1]?.startsWith('![')) parts.push({ type: 'image', alt: match[2] ?? '', path: match[3] ?? '' });
    else if (match[4]) {
      const target = match[5] ?? '';
      parts.push({ type: 'link', label: inline(match[4]), target, internal: !/^https?:\/\//i.test(target) });
    } else if (match[6]) parts.push({ type: 'bold', children: inline(match[6]) });
    else if (match[7]) parts.push({ type: 'italic', children: inline(match[7]) });
    else if (match[8]) parts.push({ type: 'code', children: [{ type: 'text', value: match[8] }] });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) parts.push({ type: 'text', value: source.slice(cursor) });
  return parts;
}

const isTableSeparator = (line: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const splitCells = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) { i++; continue; }
    const diagram = /^\[\[diagram:([a-z0-9-]+)\]\]$/.exec(line.trim());
    if (diagram) { blocks.push({ type: 'diagram', name: diagram[1] ?? '' }); i++; continue; }
    const image = /^!\[([^\]]*)\]\(images\/([^)]+)\)$/.exec(line.trim());
    if (image) { blocks.push({ type: 'image', alt: image[1] ?? '', path: `images/${image[2] ?? ''}` }); i++; continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const text = heading[2] ?? '';
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, text, id: slugHeading(text) }); i++; continue;
    }
    if (/^```/.test(line)) {
      const language = line.slice(3).trim(); const content: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) content.push(lines[i++] ?? '');
      if (i < lines.length) i++;
      blocks.push({ type: 'code', language, value: content.join('\n') }); continue;
    }
    if (/^>\s?/.test(line)) {
      const content: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) content.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      blocks.push({ type: 'tip', children: inline(content.join(' ')) }); continue;
    }
    if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1] ?? '')) {
      const rows: InlinePart[][][] = [splitCells(line).map(inline)]; i += 2;
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) rows.push(splitCells(lines[i++] ?? '').map(inline));
      blocks.push({ type: 'table', rows }); continue;
    }
    const listMatch = /^\s*([-*+] |\d+[.)] )(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1] ?? ''); const items: { children: InlinePart[]; nested?: { ordered: boolean; items: InlinePart[][] } }[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const item = /^\s*([-*+] |\d+[.)] )(.*)$/.exec(current);
        // An indented line only ends the list after its first item, so an indented list still makes progress.
        if (!item || (items.length > 0 && current.startsWith('  '))) break;
        i++; const entry: { children: InlinePart[]; nested?: { ordered: boolean; items: InlinePart[][] } } = { children: inline(item[2] ?? '') };
        const nestedItems: InlinePart[][] = []; let nestedOrdered = false;
        while (i < lines.length) {
          const nested = /^\s{2,}([-*+] |\d+[.)] )(.*)$/.exec(lines[i] ?? '');
          if (!nested) break;
          nestedOrdered ||= /^\d/.test(nested[1] ?? ''); nestedItems.push(inline(nested[2] ?? '')); i++;
        }
        if (nestedItems.length) entry.nested = { ordered: nestedOrdered, items: nestedItems };
        items.push(entry);
      }
      blocks.push({ type: 'list', ordered, items }); continue;
    }
    const paragraph: string[] = [line.trim()]; i++;
    while (i < lines.length && (lines[i] ?? '').trim() && !/^(#{1,3})\s|^```|^>\s?|^\[\[diagram:|^!\[[^\]]*\]\(images\/|^\s*([-*+] |\d+[.)] )/.test(lines[i] ?? '')) {
      if ((lines[i] ?? '').includes('|') && isTableSeparator(lines[i + 1] ?? '')) break;
      paragraph.push((lines[i++] ?? '').trim());
    }
    blocks.push({ type: 'paragraph', children: inline(paragraph.join(' ')) });
  }
  return blocks;
}

export function themedImagePath(path: string, theme: 'light' | 'dark'): string {
  return path.replace(/\.jpg$/i, `-${theme}.jpg`);
}
