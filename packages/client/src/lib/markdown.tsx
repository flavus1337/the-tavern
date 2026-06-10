import type { ReactNode } from 'react';

/**
 * Minimal, dependency-free markdown renderer for notes.
 * Supports: # ## ### headings, - bullet lists, 1. numbered lists,
 * **bold**, *italic*, `code`, paragraphs. Renders React elements directly —
 * no HTML strings, so user content can never inject markup.
 */
export function renderMarkdown(text: string): ReactNode {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    if (listType === 'ul') {
      blocks.push(<ul key={key++} className="list-disc pl-5 space-y-0.5">{listItems}</ul>);
    } else {
      blocks.push(<ol key={key++} className="list-decimal pl-5 space-y-0.5">{listItems}</ol>);
    }
    listItems = [];
    listType = null;
  }

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);

    if (bullet) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(<li key={key++}>{renderInline(bullet[1] ?? '')}</li>);
    } else if (numbered) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(<li key={key++}>{renderInline(numbered[1] ?? '')}</li>);
    } else if (heading) {
      flushList();
      const level = (heading[1] ?? '#').length;
      const content = renderInline(heading[2] ?? '');
      if (level === 1) blocks.push(<h1 key={key++} className="text-xl font-bold text-[var(--hi)] mt-3 first:mt-0">{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={key++} className="text-lg font-semibold text-[var(--hi)] mt-3 first:mt-0">{content}</h2>);
      else blocks.push(<h3 key={key++} className="text-base font-semibold text-[var(--hi)] mt-2 first:mt-0">{content}</h3>);
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={key++} className="leading-relaxed">{renderInline(line)}</p>);
    }
  }
  flushList();

  return <div className="space-y-1.5 text-sm text-[var(--mid)]">{blocks}</div>;
}

/** Inline: **bold**, *italic*, `code`. */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Tokenize: code first (no nesting inside), then bold, then italic.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(<code key={key++} className="bg-[var(--raised)] text-[var(--hi)] rounded px-1 py-0.5 text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key++} className="font-semibold text-[var(--hi)]">{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
