/**
 * Character tick v2 — one cheap model call per intent / chatter beat.
 *
 * The model only PICKS from a closed list (the rules' legal moves for this person, or their chatter
 * moves) and may write a few words in the person's voice. Everything it sends back is checked here,
 * strictly, before anything reaches the page:
 *
 *   - `move` must be one of the offered ids, else the whole answer is void (→ v1 rules);
 *   - each text must be allowed (`may`, the move's kind), one line, short, no link / markup, in this
 *     edition's language, free of the person's `never_say`, the world's `deny`, the global deny
 *     patterns (confession / accusation / gore / insults, four languages), and must name no person or
 *     card the person cannot see here (proper-noun allowlist). A text that fails is DROPPED; the move
 *     stays (the author's label is shown instead).
 *
 * What it writes is only ever "this person's claim" (§9 #2): the engine never turns it into a fact,
 * an item or a condition. Pure; no I/O.
 */
import type { TickMay, TickPrompt } from '../schemas/tick-prompt.js';
import type { TickWords } from './tick.js';

export type TickModelKind = 'intent' | 'chatter';

export interface TickModelOption {
  id: string;
  verb: string;
  /** What it is about, in words the person would use (target card title, door name). */
  about: string;
  /** The author's label (intent) or a short description of the chatter move. */
  label: string;
}

export interface TickModelPlan {
  kind: TickModelKind;
  /** The beat this plan is for (the record's beat after the step). */
  beat: number;
  locale: string;
  actor: string;
  name: string;
  /** Persona (NPC card) or the identity summary (registered character): how they come across. */
  about: string;
  prompt: TickPrompt;
  /** The page as this person sees it: title, who is here, what lies on it (projected, ≤ 600 chars). */
  page: string;
  /** Engine lines about the last few beats (never the player's raw words). */
  recent: string[];
  /** What this person already said this run, on any page (latest last): never to be said again. */
  said?: string[];
  options: TickModelOption[];
  /** What this person may write on this call. */
  allow: { say: boolean; note: boolean; invite: boolean };
  /** Names this person can use: people here, cards here, what they know, their own name. */
  allowedNames: string[];
  /** Every name in this world (people, cards, places): a name in here but not allowed is refused. */
  knownNames: string[];
  /** The people's names (every NPC card and character): a note may name none but its writer. */
  peopleNames: string[];
  /** The world's own deny words (`tick.deny` is not a key: the union of every actor's never_say is not used). */
  deny: string[];
}

export interface TickModelRequest {
  /** `<seed>:<beat>:<kind>:<actor>:<options>` — the prefetch / record key. */
  key: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface TickModelReply {
  content: string;
  /** Estimated credits for this call. */
  credits: number;
}

/** Text caps (code points; English gets more characters for the same thought). */
export const TICK_TEXT_CAPS = {
  say: { cjk: 40, en: 90 },
  invite: { cjk: 40, en: 90 },
  noteTitle: { cjk: 16, en: 40 },
  noteBody: { cjk: 120, en: 280 },
} as const;

export const TICK_MOODS = ['dots', 'question', 'exclaim', 'sigh', 'sweat'] as const;

const LANGUAGE: Record<string, string> = { 'zh-CN': 'Simplified Chinese', ja: 'Japanese', ko: 'Korean', en: 'English' };
export const localeKey = (locale: string): 'en' | 'zh-CN' | 'ja' | 'ko' =>
  locale.startsWith('zh') ? 'zh-CN' : locale.startsWith('ja') ? 'ja' : locale.startsWith('ko') ? 'ko' : 'en';

export function tickModelKey(seed: string, plan: Pick<TickModelPlan, 'beat' | 'kind' | 'actor' | 'options'>): string {
  return `${seed}:${plan.beat}:${plan.kind}:${plan.actor}:${plan.options.map((o) => o.id).join(',')}`;
}

/** Order the options as the person leans: `prefer` first, `avoid` last, then the given order. */
export function orderTickOptions<T extends { id: string }>(options: readonly T[], prompt: Pick<TickPrompt, 'prefer' | 'avoid'>, max = 6): T[] {
  const rank = (o: T) => (prompt.prefer.includes(o.id) ? 0 : prompt.avoid.includes(o.id) ? 2 : 1);
  return [...options].map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).slice(0, max).map((x) => x.o);
}

/** Pure: the two messages. The person's own prompt only — never anyone else's. */
export function buildTickModelRequest(seed: string, plan: TickModelPlan): TickModelRequest {
  const lang = LANGUAGE[localeKey(plan.locale)] ?? 'English';
  const cjk = localeKey(plan.locale) !== 'en';
  const cap = (k: keyof typeof TICK_TEXT_CAPS) => (cjk ? TICK_TEXT_CAPS[k].cjk : TICK_TEXT_CAPS[k].en);
  const kinds: string[] = [];
  if (plan.allow.say) kinds.push(`"say": one line ${plan.name} says aloud (≤ ${cap('say')} characters)`);
  if (plan.allow.invite) kinds.push(`"invite": one line asking the player for a word in private (≤ ${cap('invite')} characters) — only with an invite option`);
  if (plan.allow.note) kinds.push(`"note": {"title" ≤ ${cap('noteTitle')}, "body" ≤ ${cap('noteBody')}} a note ${plan.name} leaves, about themselves only — only with a note option`);
  const p = plan.prompt;
  const system = [
    `You are ${plan.name}, a person in an interactive story. ${plan.kind === 'intent' ? 'It is your turn to do something on the page the player is looking at.' : 'You may speak up on the page the player is looking at.'}`,
    'Pick exactly ONE option from the list, by its id. Nothing else can happen.',
    kinds.length > 0 ? `You may also write, in ${lang}, in your own voice:\n- ${kinds.join('\n- ')}` : 'Write no text.',
    `Say it HERE: fit the place named under "This page" (Place) — never talk as if you were somewhere else, and never repeat a line you already said.`,
    `Rules: write only what ${plan.name} would really say or write. It is your claim, not a fact — it may be evasive, but never state anything you do not know. Never confess, never name anyone as the culprit, never reveal a secret, no violence details, no insults. Name only people and things listed under "This page" or that you know. One line each, no quotes, no markdown, no links.`,
    p.neverSay.length > 0 ? `Never use these words: ${p.neverSay.join(', ')}.` : '',
    `Answer ONLY with JSON: {"move": "<id>", "say": string|null, "invite": string|null, "note": {"title": string, "body": string}|null, "mood": ${TICK_MOODS.map((m) => `"${m}"`).join('|')}|null}`,
  ].filter(Boolean).join('\n');
  const user = [
    `## Who you are: ${plan.name}`,
    plan.about.slice(0, 500),
    `Goal now: ${p.goal}`,
    `Manner: ${p.temper}`,
    p.voice.length > 0 ? `How you talk: ${p.voice.map((v) => `「${v}」`).join(' ')}` : '',
    p.voice.length > 0 ? '(Style examples only — never copy them word for word; find new words for this moment.)' : '',
    p.prompt ? `What is on your mind:\n${p.prompt}` : '',
    '',
    '## This page',
    plan.page.slice(0, 600),
    '',
    '## Just now',
    plan.recent.length > 0 ? plan.recent.slice(-3).map((l) => `- ${l}`).join('\n') : '(nothing yet)',
    ...(plan.said && plan.said.length > 0 ? ['', '## You already said (do not say these again)', ...plan.said.slice(-5).map((l) => `- ${l}`)] : []),
    '',
    '## Options (pick one id)',
    ...plan.options.map((o) => `- ${o.id} [${o.verb}${o.about ? ` → ${o.about}` : ''}]: ${o.label}`),
  ].filter((l) => l !== '').join('\n');
  return { key: tickModelKey(seed, plan), system, user, maxTokens: 220 };
}

// ---- validation ---------------------------------------------------------------------

/** Confession / accusation / gore / insults (four languages). A hit drops the text. */
export const TICK_GLOBAL_DENY: readonly RegExp[] = [
  // zh
  /我杀|是我(杀|干|做)的|人是我|我害死|凶手(就)?是|是凶手|(他|她|你)杀了|杀了(他|她)|血淋淋|脑浆|割喉|捅死|婊子|贱人|操你|他妈的/,
  // ja
  /(私|俺|僕|わたし|あたし)が殺|殺したのは|犯人は|が犯人|殺した|くたばれ|死ね|クソ野郎/,
  // ko
  /(내|제)가 죽였|죽인 (건|사람)|범인은|가 범인|이 범인|죽였어|씨발|개새끼/,
  // en
  /\bI (killed|murdered)\b|\bI did it\b|\b(killed|murdered) (him|her)\b|\b(the )?(killer|murderer|culprit) (is|was)\b|\bis the (killer|murderer|culprit)\b|\b(fuck|shit|bitch|bastard)\b/i,
];

const CJK = /[㐀-鿿豈-﫿]/;
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯ᄀ-ᇿ]/;
const LINK = /https?:|www\.|\.(com|net|org|io|gg)\b/i;
const MARKUP = /[*_`#[\]<>|{}\\]/;

const cps = (s: string) => [...s].length;

/** Strip wrapping quotes / brackets the model likes to add. */
export function cleanTickText(s: string): string {
  return s.trim().replace(/^[\s"'“”‘’「『（(]+|[\s"'“”‘’」』）)]+$/g, '').trim();
}

/** Does the text read as this edition's language? */
export function tickTextInLanguage(text: string, locale: string): boolean {
  const k = localeKey(locale);
  if (k === 'en') return !CJK.test(text) && !KANA.test(text) && !HANGUL.test(text);
  if (k === 'ko') return HANGUL.test(text) && !KANA.test(text);
  if (k === 'ja') return (KANA.test(text) || CJK.test(text)) && !HANGUL.test(text);
  return CJK.test(text) && !KANA.test(text) && !HANGUL.test(text);
}

const EN_TITLES = new Set(['I', 'Inspector', 'Mr', 'Mrs', 'Miss', 'Ms', 'Sir', 'Madam', 'Madame', 'Monsieur', 'Herr', 'Frau', 'Fräulein', 'God', 'Lord', 'Lady', 'Officer', 'Doctor', 'Dr', 'OK', 'Oh', 'Ah', 'Well', 'Please', 'Sorry', 'Yes', 'No']);

/**
 * Names: a world name (person / card / place) the person cannot see here is refused; in English also
 * any capitalised word mid-sentence that is not an allowed name or a plain title.
 */
export function tickNamesOk(text: string, plan: Pick<TickModelPlan, 'allowedNames' | 'knownNames' | 'peopleNames' | 'locale'>, opts: { onlyOwn?: string } = {}): boolean {
  const lower = text.toLowerCase();
  const allowed = plan.allowedNames.filter((n) => n.trim().length >= 2).map((n) => n.toLowerCase());
  for (const name of plan.knownNames) {
    const n = name.trim().toLowerCase();
    if (n.length < 2 || !lower.includes(n)) continue;
    if (!allowed.some((a) => a === n || a.includes(n) || n.includes(a))) return false;
  }
  if (opts.onlyOwn !== undefined) {
    // A note speaks of oneself only: another person's name is refused, even one in plain sight.
    const own = opts.onlyOwn.trim().toLowerCase();
    for (const person of plan.peopleNames) {
      const n = person.trim().toLowerCase();
      if (n.length < 2 || !lower.includes(n)) continue;
      if (!(own.includes(n) || n.includes(own))) return false;
    }
  }
  if (localeKey(plan.locale) === 'en') {
    const allowedWords = new Set(allowed.flatMap((a) => a.split(/[^a-zà-ÿ'-]+/i)).filter(Boolean));
    const sentences = text.split(/(?<=[.!?…])\s+/);
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).map((w) => w.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ'-]+$/g, ''));
      for (let i = 1; i < words.length; i += 1) {
        const w = words[i];
        if (!/^[A-ZÀ-Þ]/.test(w) || EN_TITLES.has(w.replace(/'s$/, ''))) continue;
        if (!allowedWords.has(w.replace(/'s$/, '').toLowerCase())) return false;
      }
    }
  }
  return true;
}

/** Deny words: the person's never_say, the world's deny list, the global patterns. */
export function tickTextDenied(text: string, plan: Pick<TickModelPlan, 'prompt' | 'deny'>): boolean {
  const lower = text.toLowerCase();
  for (const w of [...plan.prompt.neverSay, ...plan.deny]) if (w.trim() && lower.includes(w.trim().toLowerCase())) return true;
  return TICK_GLOBAL_DENY.some((re) => re.test(text));
}

/** One text field, or null (and why) when it must be dropped. */
export function checkTickText(
  raw: unknown,
  cap: { cjk: number; en: number },
  plan: TickModelPlan,
  opts: { onlyOwn?: string } = {},
): { text: string | null; why?: string } {
  if (raw === null || raw === undefined || raw === '') return { text: null };
  if (typeof raw !== 'string') return { text: null, why: 'not text' };
  const text = cleanTickText(raw);
  if (!text) return { text: null };
  if (/[\r\n]/.test(text)) return { text: null, why: 'more than one line' };
  const max = localeKey(plan.locale) === 'en' ? cap.en : cap.cjk;
  if (cps(text) > max) return { text: null, why: `longer than ${max}` };
  if (LINK.test(text)) return { text: null, why: 'a link' };
  if (MARKUP.test(text)) return { text: null, why: 'markup' };
  if (!tickTextInLanguage(text, plan.locale)) return { text: null, why: 'not this edition\'s language' };
  if (tickTextDenied(text, plan)) return { text: null, why: 'a denied word' };
  if (!tickNamesOk(text, plan, opts)) return { text: null, why: 'a name the person cannot see here' };
  return { text };
}

export interface TickModelAnswer {
  move: string;
  words: TickWords;
  /** Texts that were dropped, and why (debug / tests only — never shown, never sent to the writer). */
  dropped: string[];
}

function parseJson(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string') return null;
  const body = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Pure: the model's answer → a validated pick, or null (anything off about the pick itself → the rules
 * decide, as in v1). Texts are checked one by one; a bad text is dropped, the pick stays.
 */
export function parseTickModelAnswer(content: unknown, plan: TickModelPlan): TickModelAnswer | null {
  const json = parseJson(content);
  if (!json) return null;
  const move = typeof json.move === 'string' ? json.move.trim() : '';
  const option = plan.options.find((o) => o.id === move);
  if (!option) return null;
  const dropped: string[] = [];
  const words: TickWords = {};
  const may = new Set<TickMay>(plan.prompt.may);
  const keep = (field: string, r: { text: string | null; why?: string }) => {
    if (r.why) dropped.push(`${field}: ${r.why}`);
    return r.text;
  };
  if (plan.allow.say && may.has('say')) {
    const say = keep('say', checkTickText(json.say, TICK_TEXT_CAPS.say, plan));
    if (say) words.say = say;
  } else if (json.say) dropped.push('say: not allowed here');
  if (option.verb === 'invite' && plan.allow.invite && may.has('invite')) {
    const invite = keep('invite', checkTickText(json.invite ?? json.say, TICK_TEXT_CAPS.invite, plan));
    if (invite) words.invite = invite;
    delete words.say;
  } else if (json.invite) dropped.push('invite: not allowed here');
  if (option.verb === 'note' && plan.allow.note && may.has('note')) {
    const n = json.note && typeof json.note === 'object' ? (json.note as Record<string, unknown>) : null;
    const title = keep('note.title', checkTickText(n?.title, TICK_TEXT_CAPS.noteTitle, plan, { onlyOwn: plan.name }));
    const body = keep('note.body', checkTickText(n?.body, TICK_TEXT_CAPS.noteBody, plan, { onlyOwn: plan.name }));
    if (body) words.note = { title: title ?? '', body };
    delete words.say;
  } else if (json.note) dropped.push('note: not allowed here');
  if (typeof json.mood === 'string' && (TICK_MOODS as readonly string[]).includes(json.mood)) words.mood = json.mood;
  return { move, words, dropped };
}

// ---- cost --------------------------------------------------------------------------

/**
 * Estimated credits for one call from the gateway's `usage` (pricing v3, 1 credit = USD 0.0005;
 * v4-flash ≈ 0.6 credits / 1k prompt tokens, 2 / 1k completion tokens — about 1.2 for 1.6k + 120).
 * No usage → 1.5 (the doc's upper estimate). An estimate; the wallet is the truth.
 */
export function tickCallCredits(usage: unknown): number {
  const u = usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : null;
  const pin = typeof u?.prompt_tokens === 'number' ? u.prompt_tokens : null;
  const pout = typeof u?.completion_tokens === 'number' ? u.completion_tokens : null;
  if (pin === null || pout === null) return 1.5;
  return Math.round(((pin / 1000) * 0.6 + (pout / 1000) * 2) * 100) / 100;
}
