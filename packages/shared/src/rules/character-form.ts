/**
 * A character's forms.
 *
 * One character, one id, one memory — but more than one face. 「归乡」's
 * companion first appears as a girl of nineteen and is later seen as the old
 * woman she really is. The switch is an ordinary declared state, so the world
 * flips it with an ordinary command (`set_state`) and triggers can read it
 * (`<characterId>.form`):
 *
 * ```yaml
 * # characters/<id>/README.md
 * name: 莲妹                      # the base form: what world.json also says
 * avatar: assets/characters/<id>.webp
 * voice: gentle-calm
 * states:
 *   - { id: form, label: 样子, type: enum, values: [young, elder], initial: young, hidden: true }
 * forms:
 *   elder:
 *     name: 秀莲婆
 *     avatar: assets/characters/<id>-po.webp
 *     voice: mature-elegant
 * ```
 *
 * The current value of the `form` state picks an entry in `forms`; the entry's
 * fields (name / avatar / voice / description) replace the base ones wherever
 * the character's identity is shown
 * (`GET /api/characters`, story events). A value with no entry — the initial
 * one, usually — is the base form. Pure: no I/O.
 */
import { currentStateValue, parseStateDecls } from './states.js';

/** The declared state that picks a form. */
export const CHARACTER_FORM_STATE = 'form';
/** What a form may replace. Everything else stays the character's own. */
export const CHARACTER_FORM_FIELDS = ['name', 'avatar', 'voice', 'description'] as const;
export type CharacterFormField = (typeof CHARACTER_FORM_FIELDS)[number];

export interface CharacterForm {
  /** The current value of the `form` state. */
  form: string;
  name?: string;
  avatar?: string;
  voice?: string;
  /** The one-line bio the character rail shows. */
  description?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The form a character README is in now, with the fields that form replaces;
 * null when the character declares no `form` state, or its current value has
 * no entry under `forms` (the base form).
 */
export function characterFormOf(frontmatter: Record<string, unknown> | null | undefined): CharacterForm | null {
  if (!isRecord(frontmatter) || !isRecord(frontmatter.forms)) return null;
  const decl = parseStateDecls(frontmatter).states.find((s) => s.id === CHARACTER_FORM_STATE);
  if (!decl) return null;
  const status = isRecord(frontmatter.status) && isRecord(frontmatter.status.data) ? frontmatter.status.data : null;
  const form = String(currentStateValue(decl, status));
  const entry = frontmatter.forms[form];
  if (!isRecord(entry)) return null;
  const out: CharacterForm = { form };
  for (const field of CHARACTER_FORM_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string' && value.trim() !== '') out[field] = value.trim();
  }
  return out;
}

/**
 * Authoring problems with a README's `forms` (check:worlds). A form must be a
 * value of an enum `form` state, and may only replace name / avatar / voice / description.
 */
export function characterFormProblems(frontmatter: Record<string, unknown> | null | undefined): string[] {
  if (!isRecord(frontmatter) || frontmatter.forms === undefined) return [];
  if (!isRecord(frontmatter.forms)) return ['forms must be a map of <form value> → { name?, avatar?, voice?, description? }'];
  const decl = parseStateDecls(frontmatter).states.find((s) => s.id === CHARACTER_FORM_STATE);
  if (!decl || decl.type !== 'enum') return ['forms needs an enum state "form" (states: - { id: form, type: enum, values: [...] })'];
  const problems: string[] = [];
  for (const [form, entry] of Object.entries(frontmatter.forms)) {
    if (!decl.values?.includes(form)) problems.push(`forms.${form}: not a value of the "form" state`);
    if (!isRecord(entry)) { problems.push(`forms.${form}: must be a map`); continue; }
    for (const [key, value] of Object.entries(entry)) {
      if (!(CHARACTER_FORM_FIELDS as readonly string[]).includes(key)) problems.push(`forms.${form}.${key}: a form replaces only ${CHARACTER_FORM_FIELDS.join(' / ')}`);
      else if (typeof value !== 'string' || value.trim() === '') problems.push(`forms.${form}.${key}: must be a non-empty string`);
    }
    if (typeof entry.avatar === 'string' && (!entry.avatar.startsWith('assets/') || entry.avatar.includes('..'))) {
      problems.push(`forms.${form}.avatar: must be a path under assets/`);
    }
  }
  return problems;
}

/** The voice a character README speaks in now: its form's voice, else its own `voice`. */
export function characterVoiceOf(frontmatter: Record<string, unknown> | null | undefined): string | undefined {
  const own = isRecord(frontmatter) && typeof frontmatter.voice === 'string' && frontmatter.voice.trim() !== '' ? frontmatter.voice.trim() : undefined;
  return characterFormOf(frontmatter)?.voice ?? own;
}
