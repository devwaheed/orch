import React, { useEffect, useState } from 'react';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useThemeStore } from '../../../services/theme.js';
import { parseMarkdown, themedImagePath, type InlinePart, type MarkdownBlock } from '../markdown.js';
import { OverviewDiagram } from './diagrams/overview.js';
import { JobFlowDiagram } from './diagrams/job-flow.js';
import { SpecFlowDiagram } from './diagrams/spec-flow.js';
import { AccountsDiagram } from './diagrams/accounts.js';

const images = import.meta.glob('../../../../../../../docs-site/images/*.jpg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const diagrams: Record<string, () => React.JSX.Element> = { overview: OverviewDiagram, 'job-flow': JobFlowDiagram, 'spec-flow': SpecFlowDiagram, accounts: AccountsDiagram };

function imageUrl(path: string, theme: 'light' | 'dark'): string | undefined {
  const themed = themedImagePath(path, theme);
  return images[`../../../../../../../docs-site/${themed}`];
}

function Inline({ parts, onInternal }: { parts: InlinePart[]; onInternal: (target: string) => void }) {
  const theme = useThemeStore((s) => s.resolvedTheme);
  return <>{parts.map((part, i) => {
    if (part.type === 'text') return <span key={i}>{part.value}</span>;
    if (part.type === 'bold') return <strong key={i}><Inline parts={part.children} onInternal={onInternal} /></strong>;
    if (part.type === 'italic') return <em key={i}><Inline parts={part.children} onInternal={onInternal} /></em>;
    if (part.type === 'code') return <code key={i} className="rounded bg-panel2 px-1 font-mono text-sm">{part.children.map((child) => child.type === 'text' ? child.value : '')}</code>;
    if (part.type === 'link') return part.internal ? <a key={i} href={`#${part.target}`} onClick={(event) => { event.preventDefault(); onInternal(part.target); }} className="text-accent underline"><Inline parts={part.label} onInternal={onInternal} /></a> : <span key={i} className="font-mono text-sm">{part.target}</span>;
    const src = imageUrl(part.path, theme);
    return src ? <figure key={i} className="my-4"><img src={src} alt={part.alt} className="w-full rounded-lg border border-line" /><figcaption className="mt-2 text-sm text-muted2">{part.alt}</figcaption></figure> : <span key={i}>{part.alt}</span>;
  })}</>;
}

function Block({ block, onInternal, onImage }: { block: MarkdownBlock; onInternal: (target: string) => void; onImage: (src: string, alt: string) => void }) {
  const theme = useThemeStore((s) => s.resolvedTheme);
  if (block.type === 'heading') {
    const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
    return <Tag id={block.id} className={block.level === 1 ? 'text-2xl font-semibold text-text' : block.level === 2 ? 'text-xl font-semibold text-text' : 'text-lg font-semibold text-text'}>{block.text}</Tag>;
  }
  if (block.type === 'paragraph') return <p><Inline parts={block.children} onInternal={onInternal} /></p>;
  if (block.type === 'code') return <pre className="overflow-x-auto rounded-lg border border-line bg-panel2 p-4 font-mono text-sm"><code>{block.value}</code></pre>;
  if (block.type === 'tip') return <aside className="flex gap-3 rounded-lg border border-info-line bg-info-bg p-4 text-info-strong"><Icon name="book" size={18} weight={1.8} /><div><strong className="block">Tip</strong><Inline parts={block.children} onInternal={onInternal} /></div></aside>;
  if (block.type === 'image') {
    const src = imageUrl(block.path, theme);
    return src ? <figure className="my-4"><button type="button" onClick={() => onImage(src, block.alt)} className="block w-full cursor-zoom-in border-0 bg-transparent p-0"><img src={src} alt={block.alt} className="w-full rounded-lg border border-line" /></button><figcaption className="mt-2 text-sm text-muted2">{block.alt}</figcaption></figure> : <p>{block.alt}</p>;
  }
  if (block.type === 'diagram') { const Diagram = diagrams[block.name]; return Diagram ? <Diagram /> : <p>[[diagram:{block.name}]]</p>; }
  if (block.type === 'table') return <div className="overflow-x-auto"><table className="w-full border-collapse text-left"><tbody>{block.rows.map((row, r) => <tr key={r} className="border-b border-line">{row.map((cell, c) => r === 0 ? <th key={c} className="p-2 font-semibold"><Inline parts={cell} onInternal={onInternal} /></th> : <td key={c} className="p-2"><Inline parts={cell} onInternal={onInternal} /></td>)}</tr>)}</tbody></table></div>;
  if (block.type === 'list') { const Tag = block.ordered ? 'ol' : 'ul'; return <Tag className={`list-inside ${block.ordered ? 'list-decimal' : 'list-disc'} space-y-2`}>{block.items.map((item, i) => <li key={i}><Inline parts={item.children} onInternal={onInternal} />{item.nested && <ol className={`ml-6 mt-2 list-inside ${item.nested.ordered ? 'list-decimal' : 'list-disc'} space-y-1`}>{item.nested.items.map((child, j) => <li key={j}><Inline parts={child} onInternal={onInternal} /></li>)}</ol>}</li>)}</Tag>; }
  return null;
}

export function Markdown({ source, onInternalLink }: { source: string; onInternalLink: (target: string) => void }) {
  const blocks = parseMarkdown(source);
  const [overlay, setOverlay] = useState<{ src: string; alt: string } | null>(null);
  useEffect(() => {
    if (!overlay) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOverlay(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [overlay]);
  return <><div className="flex flex-col gap-5 text-base leading-normal">{blocks.map((block, i) => <Block key={i} block={block} onInternal={onInternalLink} onImage={(src, alt) => setOverlay({ src, alt })} />)}</div>{overlay && <button type="button" className="fixed inset-0 z-20 flex cursor-zoom-out items-center justify-center border-0 bg-overlay p-8" aria-label="Close image" onClick={() => setOverlay(null)}><img src={overlay.src} alt={overlay.alt} className="max-h-full max-w-full rounded-lg border border-line" /></button>}</>;
}
