/**
 * The 复盘 / debrief after an ending. Pure: no I/O.
 *
 * The rule the whole feature rests on: a secret is UNLOCKED only when the answer
 * is right (tier `surface` or `hidden`) AND one of that answer's clue paths is in
 * the save. Guessing right without the evidence is shown, but does not count.
 * The debrief never changes which ending was reached — it scores the run and
 * unlocks epilogues (后日谈) and hidden-ending cards.
 */
import type { MysteryTier, WorldMystery, WorldReckoning } from '../schemas/world.js';

export type DebriefVerdict = 'surface' | 'hidden' | 'guessed' | 'wrong' | 'unanswered';
export type DebriefTier = 'all' | 'most' | 'few';

/** A mystery as the page may see it before answering: no tiers, clues or epilogues. */
export interface PublicMystery {
  id: string;
  question: string;
  hint?: string;
  options: { id: string; label: string }[];
}

export interface DebriefMysteryResult {
  id: string;
  question: string;
  /** The chosen option, or null when the player skipped this one. */
  choice: string | null;
  label: string | null;
  verdict: DebriefVerdict;
  /** Unlocked answers only: the epilogue line. */
  epilogue?: string;
  /** Hidden answers only: the hidden-ending card's title. */
  title?: string;
  /**
   * Unlocked answers only: the save path of the clue that proved it (the first
   * of the answer's clues found in the save, in place or carried). The debrief
   * page names it beside the secret.
   */
  proof?: string;
  /** The proving clue's display name; filled by the server, which can read the card. */
  proofName?: string;
}

export interface DebriefResult {
  total: number;
  /** Secrets unlocked at the surface / hidden tier (each counts once). */
  surface: number;
  hidden: number;
  unlocked: number;
  tier: DebriefTier;
  /** The world's tiered epilogue for this result; null when the world declares none. */
  epilogue: string | null;
  mysteries: DebriefMysteryResult[];
}

/** Where a clue may be found in a save: in place, or carried in the bag under the same name. */
export function clueCandidates(path: string): string[] {
  const name = path.split('/').pop() ?? path;
  const carried = `player/${name}`;
  return carried === path ? [path] : [path, carried];
}

/** Every path whose existence the scoring needs, deduplicated (the caller stats each once). */
export function debriefCluePaths(mysteries: readonly WorldMystery[]): string[] {
  const out = new Set<string>();
  for (const m of mysteries) for (const o of m.options) for (const c of o.clues) for (const p of clueCandidates(c)) out.add(p);
  return [...out].sort();
}

export function clueFound(clues: readonly string[], present: ReadonlySet<string>): boolean {
  return proofOf(clues, present) !== null;
}

/** The first save path (declared order, in place before carried) that proves one of `clues`; null when none is present. */
export function proofOf(clues: readonly string[], present: ReadonlySet<string>): string | null {
  for (const c of clues) for (const p of clueCandidates(c)) if (present.has(p)) return p;
  return null;
}

/** At least half (rounded up) is `most`; every secret is `all`; fewer (or none) is `few`. */
export function debriefTier(unlocked: number, total: number): DebriefTier {
  if (total > 0 && unlocked >= total) return 'all';
  if (unlocked > 0 && unlocked * 2 >= total) return 'most';
  return 'few';
}

export function publicMysteries(mysteries: readonly WorldMystery[]): PublicMystery[] {
  return mysteries.map((m) => ({
    id: m.id,
    question: m.question,
    ...(m.hint ? { hint: m.hint } : {}),
    options: m.options.map((o) => ({ id: o.id, label: o.label })),
  }));
}

/**
 * Validate a submitted answer map against the world's mysteries. Unknown
 * mysteries or options are errors (a stale page must not score silently);
 * a missing mystery is simply unanswered.
 */
export function normalizeDebriefAnswers(
  raw: unknown,
  mysteries: readonly WorldMystery[],
): { ok: true; answers: Record<string, string> } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '"answers" must be an object of mystery id → option id' };
  const answers: Record<string, string> = {};
  for (const [id, choice] of Object.entries(raw as Record<string, unknown>)) {
    const mystery = mysteries.find((m) => m.id === id);
    if (!mystery) return { ok: false, error: `unknown mystery "${id}"` };
    if (choice === null || choice === undefined || choice === '') continue;
    if (typeof choice !== 'string' || !mystery.options.some((o) => o.id === choice)) {
      return { ok: false, error: `mystery "${id}" has no option "${String(choice)}"` };
    }
    answers[id] = choice;
  }
  return { ok: true, answers };
}

/** Score a debrief. `present`: the clue paths (see `debriefCluePaths`) that exist in the save. */
export function scoreDebrief(
  mysteries: readonly WorldMystery[],
  answers: Readonly<Record<string, string>>,
  present: ReadonlySet<string>,
  reckoning?: WorldReckoning,
): DebriefResult {
  let surface = 0;
  let hidden = 0;
  const results: DebriefMysteryResult[] = mysteries.map((m) => {
    const option = m.options.find((o) => o.id === answers[m.id]);
    if (!option) return { id: m.id, question: m.question, choice: null, label: null, verdict: 'unanswered' };
    const base = { id: m.id, question: m.question, choice: option.id, label: option.label };
    const tier: MysteryTier = option.tier;
    if (tier === 'wrong') return { ...base, verdict: 'wrong' };
    const proof = proofOf(option.clues, present);
    if (proof === null) return { ...base, verdict: 'guessed' };
    if (tier === 'hidden') {
      hidden++;
      return { ...base, verdict: 'hidden', ...(option.epilogue ? { epilogue: option.epilogue } : {}), ...(option.title ? { title: option.title } : {}), proof };
    }
    surface++;
    return { ...base, verdict: 'surface', ...(option.epilogue ? { epilogue: option.epilogue } : {}), proof };
  });
  const unlocked = surface + hidden;
  const tier = debriefTier(unlocked, mysteries.length);
  return {
    total: mysteries.length,
    surface,
    hidden,
    unlocked,
    tier,
    epilogue: reckoning?.epilogues[tier] ?? null,
    mysteries: results,
  };
}

/**
 * What the writer and the characters are told:
 * that the world has secrets the run is scored on — never the answers — so no
 * one spells them out, and the story is never advanced by a quiz.
 */
export function debriefWriterNote(mysteries: readonly WorldMystery[] | undefined, locale?: string): string {
  if (!mysteries || mysteries.length === 0) return '';
  const zh = locale === 'zh-CN';
  const ja = locale === 'ja';
  const ko = locale === 'ko';
  const list = mysteries.map((m) => `- ${m.question}`).join('\n');
  if (zh) {
    return `## 复盘（结局之后才问）\n这个世界有 ${mysteries.length} 个秘密，结局之后会以复盘的形式问玩家：\n${list}\n不要替玩家说出答案，也不要让角色直接揭晓；让线索、搜查和角色的施压把玩家推近真相。游戏过程中绝不以提问、填表或提交推理来推进剧情。`;
  }
  if (ko) {
    return `## 복기 (엔딩이 난 뒤에만 묻는다)\n이 세계에는 비밀이 ${mysteries.length}개 있고, 엔딩이 난 뒤 복기로 플레이어에게 묻는다:\n${list}\n플레이어 대신 답을 말하지 말고, 캐릭터가 직접 밝히게 하지도 마라. 단서와 수색, 캐릭터의 압박으로 플레이어를 진상에 가까이 데려가라. 플레이 중에는 질문이나 빈칸 채우기, 추리 제출로 이야기를 진행하지 마라.`;
  }
  if (ja) {
    return `## 振り返り（結末のあとでだけ問う）\nこの世界には ${mysteries.length} つの秘密があり、結末のあとで振り返りとしてプレイヤーに問われる：\n${list}\n答えを代わりに言わない。キャラクターに直接明かさせない。手がかり・捜索・キャラクターの圧力でプレイヤーを真相へ近づける。プレイ中は質問・記入・推理の提出で物語を進めない。`;
  }
  return `## Debrief (asked only after an ending)\nThis world has ${mysteries.length} secrets the player is asked about in a debrief after the ending:\n${list}\nNever state the answers for the player, and never let a character reveal them outright; let clues, searches and character pressure bring the player close. During play, never advance the story by asking questions, filling forms or submitting deductions.`;
}
