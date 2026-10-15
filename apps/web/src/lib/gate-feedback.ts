import { AirpRequestError } from './airp-gateway.js';

export interface GateFeedback {
  title: string;
  text: string;
  items: { title: string; path: string }[];
  target: string;
}

interface Item { path: string; frontmatter: Record<string, any> | null }

// Expected gameplay refusal is not a transport failure. Never infer this from
// a human-readable string or turn other 409/500 responses into fiction.
export function gateFeedback(error: unknown, target: string, items: Item[]): GateFeedback | null {
  if (!(error instanceof AirpRequestError) || error.status !== 409 ||
      error.payload?.code !== 'requirements_not_met') return null;
  const missing = error.payload.missing;
  if (!Array.isArray(missing) || !missing.every(p => typeof p === 'string')) return null;
  const gate = items.find(i => i.path === `${target}/README.md` || i.frontmatter?.target === target);
  const fm = gate?.frontmatter;
  // Authored blocked text is a scene voice. The server's fallback includes raw
  // paths, so use that only for diagnostics, never for the performance.
  const text = typeof fm?.blocked === 'string' ? fm.blocked : '';
  return {
    target,
    title: String(fm?.title ?? fm?.name ?? ''),
    text,
    items: missing.flatMap(p => {
      const candidates = items.filter(i => i.path.startsWith('world/') && i.path.split('/').at(-1) === p.split('/').at(-1));
      const item = candidates.length === 1 ? candidates[0] : undefined;
      const title = item?.frontmatter?.title ?? item?.frontmatter?.name;
      return item && typeof title === 'string' ? [{ title, path: item.path }] : [];
    }),
  };
}
