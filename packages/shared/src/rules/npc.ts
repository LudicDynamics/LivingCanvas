/**
 * NPC objects.
 *
 * There is no NPC system: an NPC is a CARD (`type: npc`) the player can talk to.
 * It has no agent, no persona file tree and no memory of its own — the writer
 * voices it, one short reply at a time, from a brief this module builds. What
 * the NPC may say is exactly what its `knows` cards say; what it may hand over
 * is exactly what its `gives` names, and each give is an option this card
 * already declares (`choice` + `choice_actions`, or `on.choice_selected` running
 * a command) — the same declared-action path a player click takes, never a
 * parallel one.
 *
 *   ---
 *   type: npc
 *   name: 苏禾
 *   avatar: assets/characters/su-he.webp   # optional; must exist when set
 *   gender: female                         # optional; picks a default voice
 *   voice: gentle-calm                     # optional palette alias (rules/voices.ts)
 *   persona: |-                            # 1–3 lines
 *     被下了药、冻得发抖的年轻女人，说话很轻，断断续续。
 *   knows:                                 # the ONLY facts it may state
 *     - world/freight-car/su-he-testimony.md
 *   wants: 让人知道日志是被谁拿走的
 *   fears: 钟怀礼又回来
 *   gives: [take-testimony]                # option ids on THIS card
 *   choice: { options: [{ id: take-testimony, label: 记下苏禾的话 }] }
 *   choice_actions: { take-testimony: { kind: take, paths: [...] } }
 *   ---
 *
 * The exchange is kept on the card itself (`dialogue:`), so it survives a
 * reload and is part of the save like every other state.
 *
 * Pure and browser-safe: no I/O, no Node imports.
 */
import { LOCAL_VOICE_HOSTED_FALLBACK, resolveVoice, type WorldLanguage, worldLanguageOf } from './voices.js';

export const NPC_CARD_TYPE = 'npc';
/** `persona` is a sketch, not a character sheet. */
export const NPC_PERSONA_MAX_LINES = 3;
export const NPC_PERSONA_MAX_CHARS = 400;
export const NPC_KNOWS_MAX = 8;
export const NPC_GIVES_MAX = 4;
/** How much of the exchange the card keeps (oldest dropped first). */
export const NPC_DIALOGUE_KEEP = 40;
/** How much of the exchange the writer sees per reply. */
export const NPC_BRIEF_HISTORY = 12;
/** One spoken line, either side. */
export const NPC_LINE_MAX = 600;
/** Per knows card in the brief, so one long file cannot crowd out the rest. */
export const NPC_KNOWS_BODY_MAX = 3000;

/** Default voice when the card declares none: by gender, else neutral-warm. */
export const NPC_DEFAULT_VOICE: Readonly<Record<'female' | 'male' | 'unknown', string>> = Object.freeze({
  female: 'gentle-calm',
  male: 'soothing-smooth',
  unknown: 'warm-cheerful',
});

export type NpcGender = 'female' | 'male';

export interface NpcCard {
  name: string;
  avatar?: string;
  gender?: NpcGender;
  voice?: string;
  persona: string;
  knows: string[];
  wants?: string;
  fears?: string;
  gives: string[];
}

export interface NpcDialogueEntry {
  by: 'player' | 'npc';
  text: string;
  /** ISO time the line was recorded. */
  at?: string;
}

/** One knows card as the brief quotes it. */
export interface NpcKnownCard {
  path: string;
  title: string;
  body: string;
}

const KNOWS_PATH = /^(world|player)\/[a-zA-Z0-9_/-]+\.md$/;
const OPTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AVATAR_PATH = /^assets\/[\w./-]+\.(webp|png|jpe?g|gif)$/i;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function isNpcFrontmatter(frontmatter: unknown): boolean {
  return !!frontmatter && typeof frontmatter === 'object' && (frontmatter as { type?: unknown }).type === NPC_CARD_TYPE;
}

/** Option ids a card declares in its `choice` (either spelling). */
function declaredOptionIds(frontmatter: Record<string, unknown>): string[] {
  const choice = frontmatter.choice as unknown;
  const options = Array.isArray(choice)
    ? choice
    : choice && typeof choice === 'object' && Array.isArray((choice as { options?: unknown }).options)
      ? (choice as { options: unknown[] }).options
      : [];
  return options
    .map((option) => (option && typeof option === 'object' ? str((option as { id?: unknown }).id) : ''))
    .filter(Boolean);
}

function hasChoiceCommand(frontmatter: Record<string, unknown>): boolean {
  const on = frontmatter.on as unknown;
  return !!on && typeof on === 'object' && Array.isArray((on as { choice_selected?: unknown }).choice_selected);
}

/**
 * Every problem with an NPC card, in English, for the world checker and the
 * write path. Empty = valid. Path existence (`avatar`, `knows`) needs I/O and is
 * the caller's job; this checks shape only.
 */
export function npcCardErrors(frontmatter: unknown): string[] {
  const errors: string[] = [];
  if (!frontmatter || typeof frontmatter !== 'object') return ['NPC frontmatter must be a mapping'];
  const fm = frontmatter as Record<string, unknown>;
  if (fm.type !== NPC_CARD_TYPE) errors.push('type must be "npc"');

  const name = str(fm.name);
  if (!name) errors.push('name is required');
  else if (name.length > 60) errors.push('name must be at most 60 characters');

  if (fm.avatar !== undefined && (typeof fm.avatar !== 'string' || !AVATAR_PATH.test(fm.avatar) || fm.avatar.includes('..'))) {
    errors.push('avatar must be an assets/… image path (omit it until the picture exists)');
  }
  if (fm.gender !== undefined && fm.gender !== 'female' && fm.gender !== 'male') errors.push('gender must be female or male');
  if (fm.voice !== undefined && (typeof fm.voice !== 'string' || resolveVoice(fm.voice) === null)) {
    errors.push(`voice "${String(fm.voice)}" is not a palette voice (rules/voices.ts)`);
  }

  const persona = str(fm.persona);
  if (!persona) errors.push('persona is required (1–3 lines)');
  else {
    const lines = persona.split(/\n/).filter((line) => line.trim() !== '');
    if (lines.length > NPC_PERSONA_MAX_LINES) errors.push(`persona must be 1–${NPC_PERSONA_MAX_LINES} lines`);
    if (persona.length > NPC_PERSONA_MAX_CHARS) errors.push(`persona must be at most ${NPC_PERSONA_MAX_CHARS} characters`);
  }

  if (!Array.isArray(fm.knows) || fm.knows.length === 0) errors.push('knows must list 1+ world/player .md paths');
  else {
    if (fm.knows.length > NPC_KNOWS_MAX) errors.push(`knows allows at most ${NPC_KNOWS_MAX} paths`);
    for (const path of fm.knows) {
      if (typeof path !== 'string' || !KNOWS_PATH.test(path) || path.split('/').some((s) => s === '.' || s === '..')) {
        errors.push(`knows entry "${String(path)}" must be a world/… or player/… .md path`);
      }
    }
    if (new Set(fm.knows).size !== fm.knows.length) errors.push('knows paths must be unique');
  }

  for (const key of ['wants', 'fears'] as const) {
    if (fm[key] !== undefined && (typeof fm[key] !== 'string' || (fm[key] as string).length > 300)) {
      errors.push(`${key} must be one short line`);
    }
  }

  if (fm.gives !== undefined) {
    if (!Array.isArray(fm.gives)) errors.push('gives must be a list of option ids on this card');
    else {
      if (fm.gives.length > NPC_GIVES_MAX) errors.push(`gives allows at most ${NPC_GIVES_MAX} options`);
      const options = new Set(declaredOptionIds(fm));
      const actions = fm.choice_actions && typeof fm.choice_actions === 'object' ? (fm.choice_actions as Record<string, unknown>) : null;
      const command = hasChoiceCommand(fm);
      for (const id of fm.gives) {
        if (typeof id !== 'string' || !OPTION_ID.test(id)) {
          errors.push(`gives entry "${String(id)}" must be an option id`);
          continue;
        }
        if (!options.has(id)) errors.push(`gives "${id}" is not an option in this card's choice`);
        else if (!(actions && Object.hasOwn(actions, id)) && !command) {
          errors.push(`gives "${id}" needs a choice_actions entry (or on.choice_selected running a command)`);
        }
      }
    }
  }

  if (fm.portable === true) errors.push('an NPC cannot be portable');
  if (fm.dialogue !== undefined && !Array.isArray(fm.dialogue)) errors.push('dialogue must be a list (written by the engine)');
  return errors;
}

/** The card as data, or null when it is not a valid NPC. */
export function readNpcCard(frontmatter: unknown): NpcCard | null {
  if (!isNpcFrontmatter(frontmatter) || npcCardErrors(frontmatter).length > 0) return null;
  const fm = frontmatter as Record<string, any>;
  return {
    name: str(fm.name),
    ...(str(fm.avatar) ? { avatar: str(fm.avatar) } : {}),
    ...(fm.gender === 'female' || fm.gender === 'male' ? { gender: fm.gender } : {}),
    ...(str(fm.voice) ? { voice: str(fm.voice) } : {}),
    persona: str(fm.persona),
    knows: (fm.knows as string[]).slice(),
    ...(str(fm.wants) ? { wants: str(fm.wants) } : {}),
    ...(str(fm.fears) ? { fears: str(fm.fears) } : {}),
    gives: Array.isArray(fm.gives) ? (fm.gives as string[]).slice() : [],
  };
}

/** The voice alias to speak an NPC with: its own, else a gender-appropriate default. */
export function npcVoiceAlias(npc: Pick<NpcCard, 'voice' | 'gender'> | Record<string, unknown> | null | undefined): string {
  const voice = str((npc as { voice?: unknown } | null)?.voice);
  if (voice && resolveVoice(voice)) return voice;
  if (voice && Object.hasOwn(LOCAL_VOICE_HOSTED_FALLBACK, voice)) return LOCAL_VOICE_HOSTED_FALLBACK[voice];
  const gender = (npc as { gender?: unknown } | null)?.gender;
  return gender === 'female' || gender === 'male' ? NPC_DEFAULT_VOICE[gender] : NPC_DEFAULT_VOICE.unknown;
}

/** The recorded exchange, cleaned (malformed rows are dropped, never trusted). */
export function npcDialogueOf(frontmatter: unknown): NpcDialogueEntry[] {
  const raw = frontmatter && typeof frontmatter === 'object' ? (frontmatter as { dialogue?: unknown }).dialogue : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): NpcDialogueEntry[] => {
    if (!row || typeof row !== 'object') return [];
    const { by, text, at } = row as Record<string, unknown>;
    if ((by !== 'player' && by !== 'npc') || typeof text !== 'string' || text.trim() === '') return [];
    return [{ by, text: text.slice(0, NPC_LINE_MAX), ...(typeof at === 'string' ? { at } : {}) }];
  });
}

/** Append lines, keeping only the newest `keep`. */
export function appendNpcDialogue(
  previous: readonly NpcDialogueEntry[],
  entries: readonly NpcDialogueEntry[],
  keep: number = NPC_DIALOGUE_KEEP,
): NpcDialogueEntry[] {
  const next = [...previous, ...entries.map((entry) => ({ ...entry, text: entry.text.trim().slice(0, NPC_LINE_MAX) }))];
  return next.slice(Math.max(0, next.length - keep));
}

const LANGUAGE_NAME: Record<WorldLanguage, string> = { zh: 'Simplified Chinese', ja: 'Japanese', en: 'English', ko: 'Korean' };

/** Label of a declared option, for the brief. */
function optionLabel(frontmatter: Record<string, unknown> | null | undefined, id: string): string {
  const choice = frontmatter?.choice as unknown;
  const options = Array.isArray(choice) ? choice : (choice as { options?: unknown[] } | undefined)?.options ?? [];
  for (const option of options) {
    if (option && typeof option === 'object' && (option as { id?: unknown }).id === id) return str((option as { label?: unknown }).label) || id;
  }
  return id;
}

export interface NpcBriefInput {
  /** The NPC card's path. */
  path: string;
  npc: NpcCard;
  /** The NPC card's frontmatter, for option labels of its gives. */
  frontmatter?: Record<string, unknown> | null;
  /** The knows cards, already read. A path the NPC does not list is ignored. */
  knows: readonly NpcKnownCard[];
  history: readonly NpcDialogueEntry[];
  /** What the player just said. */
  line: string;
  /** World locale (`world.json#locale`) or a world language. */
  language: unknown;
  /** Gives already handed over; never offered again. */
  given?: readonly string[];
  /**
   * Character tick: what this NPC just did on
   * the page, or had done to them — engine facts, one line each.
   */
  moves?: readonly string[];
}

/**
 * The writer's instructions for ONE NPC reply. Facts come only from `knows`:
 * any card not listed there is dropped here, so the brief itself cannot leak.
 */
export function buildNpcBrief(input: NpcBriefInput): string {
  const { npc, path } = input;
  const language = LANGUAGE_NAME[worldLanguageOf(input.language)];
  const allowed = new Set(npc.knows);
  const known = input.knows.filter((card) => allowed.has(card.path));
  const given = new Set(input.given ?? []);
  const gives = npc.gives.filter((id) => !given.has(id));
  const history = input.history.slice(-NPC_BRIEF_HISTORY);

  const lines: string[] = [
    `[NPC Dialogue] The player is talking to the NPC card ${JSON.stringify(path)} — ${npc.name}.`,
    'This NPC is an object you voice for one reply. It has no agent and no memory beyond what is below.',
    '',
    'Rules:',
    `- Reply ONLY as ${npc.name}, in first person and in persona: the spoken words, at most one short action inside its marker — full-width parentheses （…） in Chinese, Japanese or Korean, *asterisks* in English. The marked action is shown but never spoken; never narrate ${npc.name} in the third person outside it. No other speakers, no options, no headings.`,
    `- ${npc.name} may state ONLY facts written in the "Knows" cards below. For anything else ${npc.name} does not know, or deflects in character. Never invent names, times, places, clues, items or outcomes; never reveal what the cards do not say.`,
    '- Keep it short: 1–3 sentences, like a person speaking.',
    `- Speak ${language}.`,
    '- Do not change the world this turn: no chalk, no file writes, no moves, no dice, no endings. The engine records the reply.',
  ];
  if (npc.wants) lines.push(`- ${npc.name} may steer the talk toward what they want: ${npc.wants}`);
  if (npc.fears) lines.push(`- ${npc.name} is afraid of: ${npc.fears}`);
  if (gives.length) {
    lines.push(
      `- ${npc.name} can hand over ONLY these declared things, and only when the talk has earned it. To hand one over, end the reply with its own line \`[give: <id>]\` (at most one per reply):`,
      ...gives.map((id) => `  - ${id} — ${optionLabel(input.frontmatter, id)}`),
      '  Nothing else can be handed over, whatever the player asks.',
    );
  } else {
    lines.push(`- ${npc.name} has nothing to hand over.`);
  }
  if (input.moves?.length) {
    lines.push(
      `- Just now, on this page (engine facts; ${npc.name} reacts to them in character — flustered, evasive or plain — and never invents more):`,
      ...input.moves.slice(-3).map((m) => `  - ${m.slice(0, 300)}`),
    );
  }
  lines.push('', `Persona: ${npc.persona}`, '', 'Knows (the only facts):');
  if (known.length === 0) lines.push('(nothing yet)');
  for (const card of known) {
    const body = card.body.trim();
    lines.push(`### ${card.title} (${card.path})`, body.length > NPC_KNOWS_BODY_MAX ? `${body.slice(0, NPC_KNOWS_BODY_MAX)}…` : body);
  }
  lines.push('', 'Conversation so far:');
  if (history.length === 0) lines.push('(this is the first thing the player says)');
  for (const entry of history) lines.push(`${entry.by === 'player' ? 'Player' : npc.name}: ${entry.text}`);
  lines.push('', `Player now says: ${JSON.stringify(input.line.trim().slice(0, NPC_LINE_MAX))}`, `Reply as ${npc.name}.`);
  return lines.join('\n');
}

const GIVE_MARKER = /\[\s*give\s*:\s*([a-z0-9-]+)\s*\]/gi;

/**
 * The writer's reply → the spoken line and the declared gives it triggered.
 * Unknown give markers are dropped (and stripped); a speaker prefix and wrapping
 * quotes are removed so the card holds only the words.
 */
export function parseNpcReply(text: string, npc: Pick<NpcCard, 'name' | 'gives'>): { line: string; gives: string[] } {
  const allowed = new Set(npc.gives);
  const gives: string[] = [];
  const stripped = String(text ?? '').replace(GIVE_MARKER, (_match, id: string) => {
    const key = id.toLowerCase();
    if (allowed.has(key) && !gives.includes(key)) gives.push(key);
    return '';
  });
  let line = stripped.trim();
  const prefix = new RegExp(`^(?:\\*\\*)?${npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\*\\*)?\\s*[:：]\\s*`);
  line = line.replace(prefix, '').trim();
  const quoted = /^[「“"](.*)[」”"]$/s.exec(line);
  if (quoted && !/[「“"」”"]/.test(quoted[1])) line = quoted[1].trim();
  return { line: line.slice(0, NPC_LINE_MAX), gives: gives.slice(0, 1) };
}

/**
 * A `knows` path that does not exist yet may be a declared find — a search or
 * dice reward whose card appears only after the roll. What the NPC knows is then
 * the declared reward text (its first declaration), so a witness can tell what
 * they saw before the player has rolled for the written account. Pure: pass the
 * frontmatter of a card that may declare it.
 */
export function declaredRewardCard(frontmatter: unknown, path: string): { title: string; body: string } | null {
  if (!frontmatter || typeof frontmatter !== 'object') return null;
  const fm = frontmatter as Record<string, unknown>;
  const bandLists: unknown[] = [fm.dice_outcomes];
  if (Array.isArray(fm.search)) for (const spot of fm.search) if (spot && typeof spot === 'object') bandLists.push((spot as { dice_outcomes?: unknown }).dice_outcomes);
  for (const bands of bandLists) {
    if (!Array.isArray(bands)) continue;
    for (const band of bands) {
      const rewards = band && typeof band === 'object' ? (band as { rewards?: unknown }).rewards : undefined;
      if (!Array.isArray(rewards)) continue;
      for (const reward of rewards) {
        if (!reward || typeof reward !== 'object') continue;
        const r = reward as { path?: unknown; title?: unknown; body?: unknown };
        if (r.path === path && typeof r.body === 'string') return { title: typeof r.title === 'string' ? r.title : path, body: r.body };
      }
    }
  }
  return null;
}
