import React, { useLayoutEffect, useMemo, useRef } from 'react';

/**
 * Mini-markdown → DOM. Pure node construction — never innerHTML. Every piece
 * of LLM-authored text is DATA, not markup: all content lands through
 * textContent/createTextNode, so `<img src=x onerror=…>` renders as plain text.
 *
 * Supported grammar:
 *   - paragraphs (blocks separated by a blank line)
 *   - soft line breaks (single newline inside a block → <br>)
 *   - inline `**bold**`, `*italic*`, `` `code` ``
 *   - the world note-file convention: a leading `<b>Title</b>` block (note.md)
 *     or `# Heading` first line (world/README.md etc.) renders as a titled
 *     block followed by body paragraphs — the `<b>` tag is parsed structurally
 *     and its text still lands via textContent.
 */
export function markdownToDom(body: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'space-y-1';

  const src = String(body ?? '').trim();
  if (!src) return root;

  // `<b>Title</b>\n…` — world note files (doc-10 E2 note card form).
  const boldTitle = src.match(/^<b>([\s\S]*?)<\/b>\s*(?:\n+([\s\S]*))?$/);
  if (boldTitle) {
    addBlock(root, boldTitle[1].trim(), true);
    for (const raw of (boldTitle[2] ?? '').split(/\n\s*\n/)) {
      const block = raw.trim();
      if (block) addBlock(root, block);
    }
    return root;
  }

  // `# Heading` first line — world README files use the same title-first shape.
  const hashTitle = src.match(/^#\s+([^\n]+)\s*(?:\n+([\s\S]*))?$/);
  if (hashTitle) {
    addBlock(root, hashTitle[1].trim(), true);
    for (const raw of (hashTitle[2] ?? '').split(/\n\s*\n/)) {
      const block = raw.trim();
      if (block) addBlock(root, block);
    }
    return root;
  }

  for (const raw of src.split(/\n\s*\n/)) {
    const block = raw.trim();
    if (block) addBlock(root, block);
  }
  return root;
}

function addBlock(parent: HTMLElement, block: string, title = false): void {
  const el = document.createElement(title ? 'h3' : 'p');
  if (title) el.className = 'font-serif font-bold text-sm';
  const lines = block.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) el.appendChild(document.createElement('br'));
    appendInline(el, line.trimEnd());
  });
  parent.appendChild(el);
}

/** **bold** / *italic* / `code` inline tokens; everything else stays text. */
function appendInline(parent: HTMLElement, text: string): void {
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const el = document.createElement(m[2] ? 'strong' : m[3] ? 'em' : 'code');
    el.textContent = m[2] || m[3] || m[4]; // captured raw content is data, not markup
    if (el.tagName === 'CODE') {
      el.className = 'font-mono text-[11px] px-1 rounded';
      el.style.backgroundColor = 'rgba(41, 40, 32, 0.08)'; // v2 --ink at 8%
    }
    parent.appendChild(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

/**
 * React wrapper that mounts a markdownToDom tree into the DOM without ever
 * going through an HTML string (the mounted node is built, not parsed).
 */
export const MarkdownText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const node = useMemo(() => markdownToDom(text), [text]);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.replaceChildren(node);
  }, [node]);
  return React.createElement('div', { ref, className });
};

/**
 * Flatten markdown to a single plain-text line for card previews.
 * Strips the structural markers the mini-markdown parser hides (`#` headings,
 * `<b>` titles) plus inline emphasis, and collapses all whitespace — a card
 * face shows an excerpt, never raw markdown source. Prefers the first real
 * body paragraph, so a README's heading line doesn't become the excerpt.
 */
export function plainExcerpt(body: string): string {
  const src = stripLeadingTitle(body)
    .replace(/[*`]/g, '') // inline emphasis markers
    .replace(/^[-*+]\s+/gm, '') // list bullets
    .replace(/\s+/g, ' ');
  return src.trim();
}

/**
 * Drop a README/note's leading title line (`<b>Title</b>` or `# Title`) so a
 * rendering that already shows the title elsewhere never repeats it.
 */
export function stripLeadingTitle(body: string): string {
  return String(body ?? '')
    .trim()
    .replace(/^<b>([\s\S]*?)<\/b>\s*\n*/, '')
    .replace(/^#+\s+[^\n]*\n*/, '')
    .trim();
}

/**
 * The leading title text of a note/README body (`<b>Title</b>` or `# Title`),
 * or '' when the body has none. Lets a card reuse the authored title instead
 * of showing it twice (once as a card title, once as the first body block).
 */
export function leadingTitleOf(body: string): string {
  const src = String(body ?? '').trim();
  const m = src.match(/^<b>([\s\S]*?)<\/b>/) || src.match(/^#+\s+([^\n]+)/);
  return m ? m[1].replace(/[*`]/g, '').trim() : '';
}
