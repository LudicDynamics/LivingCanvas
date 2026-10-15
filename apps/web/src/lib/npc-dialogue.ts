/**
 * npc-dialogue.ts — the page side of NPC cards.
 *
 * An NPC is a card (`type: npc`) the writer voices. Clicking one offers 「对话」;
 * that button raises ONE window event with the card, and the single
 * `NpcDialogueHost` mounted by App opens the conversation. An event rather than
 * a prop threaded through canvas, map and card panel: the card is the whole
 * input, and every surface that shows a card already has it.
 *
 * Pure helpers only (no React), so the rules are testable without a DOM.
 */
import { npcDialogueOf, npcVoiceAlias, type NpcDialogueEntry } from '@airp/shared/npc';
import type { SpeakableLine } from './use-spoken-lines.js';

export const NPC_TALK_EVENT = 'airp:npc-talk';

export interface NpcTalkRequest {
  path: string;
  frontmatter: Record<string, unknown> | null;
}

/** What the dialogue surface shows for one NPC card. */
export interface NpcTalkTarget {
  path: string;
  name: string;
  /** World-relative asset path, when the card has a portrait. */
  avatar?: string;
  /** Palette alias to speak with: the card's own, else by gender (rules/npc.ts). */
  voice: string;
  dialogue: NpcDialogueEntry[];
  /** What the player could say to them (the card's `replies:`, the design notes D2): their own bubble. */
  replies: string[];
}

export function isNpcCard(frontmatter: unknown): boolean {
  return !!frontmatter && typeof frontmatter === 'object' && (frontmatter as { type?: unknown }).type === 'npc';
}

/** The card → what the surface needs. Null when it is not an NPC card. */
export function npcTalkTarget(request: NpcTalkRequest | null | undefined): NpcTalkTarget | null {
  if (!request || typeof request.path !== 'string' || !isNpcCard(request.frontmatter)) return null;
  const fm = request.frontmatter as Record<string, unknown>;
  const name = typeof fm.name === 'string' && fm.name.trim()
    ? fm.name.trim()
    : (request.path.split('/').pop() ?? request.path).replace(/\.md$/, '');
  const avatar = typeof fm.avatar === 'string' && fm.avatar.trim() ? fm.avatar.trim() : undefined;
  const replies = Array.isArray(fm.replies)
    ? fm.replies.filter((l): l is string => typeof l === 'string' && l.trim() !== '').map((l) => l.trim()).slice(0, 3)
    : [];
  return { path: request.path, name, ...(avatar ? { avatar } : {}), voice: npcVoiceAlias(fm), dialogue: npcDialogueOf(fm), replies };
}

/** Ask the host to open a conversation with this card. */
export function requestNpcTalk(request: NpcTalkRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<NpcTalkRequest>(NPC_TALK_EVENT, { detail: request }));
}

/** The glyph for an NPC without a portrait: its first letter, or a silhouette. */
export function npcInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '👤';
}

/** Stable numeric id for one recorded line (the speaker keys "already said" on it). */
export function npcLineId(entry: NpcDialogueEntry, index: number): number {
  let hash = 0x811c9dc5;
  const text = `${entry.at ?? index}|${entry.by}|${entry.text}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/**
 * The lines the speaker may voice: only what was said AFTER the conversation was
 * opened (`seen` holds the ids already on the card then), so reopening an NPC
 * never re-reads their last answer. NPC lines map to the speaker's `character`.
 */
export function npcSpeakableLines(dialogue: readonly NpcDialogueEntry[], seen: ReadonlySet<number>): SpeakableLine[] {
  return dialogue
    .map((entry, index) => ({ entry, id: npcLineId(entry, index) }))
    .filter(({ id }) => !seen.has(id))
    .map(({ entry, id }) => ({
      id,
      who: entry.by === 'player' ? 'player' as const : 'character' as const,
      text: entry.text,
      emo: 'normal' as const,
      pending: false,
    }));
}
