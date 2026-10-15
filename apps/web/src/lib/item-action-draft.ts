export type DraftItem = {
  path: string;
  filename: string;
  frontmatter: Record<string, unknown> | null;
};

export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function displayTitle(item: DraftItem): string {
  const title = typeof item.frontmatter?.title === 'string' && item.frontmatter.title.trim()
    ? item.frontmatter.title
    : item.filename;
  return title.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || item.filename;
}
function encodePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment).replace(/[()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

function decodePath(value: string): string | null {
  try {
    // Decode each segment so an encoded slash cannot change the path shape.
    return value.split('/').map((segment) => decodeURIComponent(segment)).join('/');
  } catch {
    return null;
  }
}

/** Render the only player-editable representation of a carried item reference. */
export function itemDraftReference(item: DraftItem): string {
  return `[${displayTitle(item)}](${encodePath(item.path)})`;
}

/** Return current-backpack paths referenced by valid Markdown links, in first-seen order. */
export function referencedItemPaths(text: string, items: DraftItem[]): string[] {
  const known = new Set(items.map((item) => item.path));
  const found: string[] = [];
  const linkPattern = /\[[^\]\r\n]*\]\(([^)\r\n]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(text)) !== null) {
    const decoded = decodePath(match[1]);
    if (decoded !== null && known.has(decoded) && !found.includes(decoded)) found.push(decoded);
  }
  return found;
}

export function appendItemAction(text: string, item: DraftItem, t: Translate): string {
  if (referencedItemPaths(text, [item]).includes(item.path)) return text;
  const sentence = t('Use {item}.', { item: itemDraftReference(item) });
  return text ? `${text} ${sentence}` : sentence;
}

const ITEM_PROMPT_INSTRUCTIONS = [
  'Read each referenced item at its exact path and read the full current scene README, including its frontmatter and intent.',
  'These references are context only: they do not mean automatically consume, combine, move, or bypass scene conditions.',
  'For a valid action, use the existing action tools and record the result. If the intended action is unclear, ask in Chalk.',
].join(' ');

export function buildItemActionPrompt(text: string, items: DraftItem[]): string {
  const paths = referencedItemPaths(text, items);
  if (paths.length === 0) return text;
  return `${text}\n\n${ITEM_PROMPT_INSTRUCTIONS}\nExact item paths:\n${paths.map((path) => `- ${path}`).join('\n')}`;
}
