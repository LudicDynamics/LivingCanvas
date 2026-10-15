import React from 'react';

/**
 * The small Markdown a board text may use, built as React elements — never HTML from the text, so `<b>` stays
 * the four characters `<b>`.
 *
 * - `announcement` (the old announcements): paragraphs (blank line), `- ` lists, **bold**, *italic*, `code` and
 *   [links](https://…) (http(s)).
 * - `log` (日志 v5, data 日志接口 §5): paragraphs, **bold**, [text](https://…), `- ` lists, and a line that is only
 *   `![alt](https://…)` = a picture. Nothing else is markup (a `*` or a backtick stays as it is); https only.
 *
 * Links open in a new tab without the opener; pictures load lazily without a referrer.
 */
export type MarkupVariant = 'announcement' | 'log';
const INLINE: Record<MarkupVariant, RegExp> = {
  announcement: /\*\*(?<b>[^*]+)\*\*|\*(?<i>[^*]+)\*|`(?<c>[^`]+)`|\[(?<lt>[^\]]+)\]\((?<lu>https?:\/\/[^\s)]+)\)/g,
  log: /\*\*(?<b>[^*]+)\*\*|\[(?<lt>[^\]]+)\]\((?<lu>https:\/\/[^\s)]+)\)/g,
};
const IMAGE_LINE = /^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/;

export function inline(text: string, key = 'i', variant: MarkupVariant = 'announcement'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE[variant])) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    const g = m.groups ?? {};
    if (g.b !== undefined) out.push(<strong key={k}>{g.b}</strong>);
    else if (g.i !== undefined) out.push(<em key={k}>{g.i}</em>);
    else if (g.c !== undefined) out.push(<code key={k}>{g.c}</code>);
    else out.push(<a key={k} href={g.lu} target="_blank" rel="noopener noreferrer">{g.lt}</a>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST_ITEM = /^\s*[-*]\s+/;
const LOG_LIST_ITEM = /^\s*-\s+/;

export function MiniMarkdown({ text, className, variant = 'announcement' }: { text: string; className?: string; variant?: MarkupVariant }) {
  const item = variant === 'log' ? LOG_LIST_ITEM : LIST_ITEM;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  blocks.forEach((block, i) => {
    // a log's picture line splits its block: text before, the picture, text after
    const parts: Array<{ image: RegExpExecArray } | { lines: string[] }> = [];
    for (const line of block.split('\n')) {
      const image = variant === 'log' ? IMAGE_LINE.exec(line.trim()) : null;
      if (image) parts.push({ image });
      else if (parts.length && 'lines' in parts[parts.length - 1]!) (parts[parts.length - 1] as { lines: string[] }).lines.push(line);
      else parts.push({ lines: [line] });
    }
    parts.forEach((part, p) => {
      const key = `${i}-${p}`;
      if ('image' in part) {
        out.push(<figure key={key}><img src={part.image[2]} alt={part.image[1]} loading="lazy" decoding="async" referrerPolicy="no-referrer" /></figure>);
        return;
      }
      const lines = part.lines;
      if (lines.every((l) => item.test(l))) {
        out.push(<ul key={key}>{lines.map((l, j) => <li key={j}>{inline(l.replace(item, ''), `${key}-${j}`, variant)}</li>)}</ul>);
        return;
      }
      out.push(<p key={key}>{lines.flatMap((l, j) => (j ? [<br key={`br-${j}`} />, ...inline(l, `${key}-${j}`, variant)] : inline(l, `${key}-${j}`, variant)))}</p>);
    });
  });
  return <div className={className}>{out}</div>;
}

/** The same text without its markup, for a one-line preview (the world card): link text kept, pictures dropped. */
export function plainText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !IMAGE_LINE.test(l.trim()))
    .map((l) => l.replace(LOG_LIST_ITEM, '· ').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '$1'))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
