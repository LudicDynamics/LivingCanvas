/**
 * Per-beat policy for the writer's existing tool loop.
 *
 * Pure functions + env readers only; `lifecycle.ts` owns the state they read
 * (the base thinking level, whether the last beat hit a tool error, whether the
 * current beat has landed). Kept out of lifecycle so each rule is testable
 * without a live agent.
 */

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

// ——— §2 thinking: off for ordinary beats, the configured level for big ones ———

/**
 * Words that mark a beat as touching the world's ending or its rules — leaving,
 * ending, time moving, the loop. Matched case-insensitively against the whole
 * prompt (a choice event carries its option label, so a 「一个人从小路下山」
 * click matches too). A false positive only costs one beat of thinking.
 */
export const DEFAULT_BIG_BEAT_PATTERN =
  '\\b(?:leave|leaving|exit|escape|ending|the end|finish|give up|go home|wake up|time pass|let time|wait until|next (?:day|morning|night)|tomorrow|sleep|loop|start over|restart|reset)\\b' +
  '|离开|离去|逃|结束|结局|终局|完结|回家|下山|睡觉|过夜|天亮|明天|第二天|入夜|时间过去|让时间|时辰|等到|循环|轮回|重来|重新开始|醒来' +
  '|帰る|離れ|逃げ|終わ|結末|エンディング|眠る|寝る|明日|翌日|夜明け|時間が経|ループ|やり直' +
  '|떠나|끝내|결말|내일|잠들|루프|다시 시작';

export interface WriterThinkingConfig {
  /** `adaptive` (default): off unless the beat is big. `fixed`: always the base level (the old behaviour). */
  mode: 'adaptive' | 'fixed';
  bigBeat: RegExp;
}

/**
 * `AIRP_WRITER_THINKING_MODE=fixed` restores the old behaviour;
 * `AIRP_WRITER_BIG_BEAT` replaces the keyword pattern (a regular expression,
 * case-insensitive). An invalid pattern falls back to the default.
 */
export function writerThinkingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WriterThinkingConfig {
  const mode = (env.AIRP_WRITER_THINKING_MODE ?? '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'adaptive';
  let bigBeat: RegExp;
  try {
    bigBeat = new RegExp((env.AIRP_WRITER_BIG_BEAT ?? '').trim() || DEFAULT_BIG_BEAT_PATTERN, 'i');
  } catch {
    bigBeat = new RegExp(DEFAULT_BIG_BEAT_PATTERN, 'i');
  }
  return { mode, bigBeat };
}

export type ThinkingReason = 'fixed' | 'base-off' | 'tool-error' | 'authoring' | 'big-beat' | 'ordinary';

/**
 * The level for the next beat.
 *
 * Big beats keep the base (configured) level: the player's words touch the
 * ending or the world's rules, the last beat's tools failed (the writer has to
 * think its way out of a broken call), or the author is building the world.
 * Everything else runs with thinking off — measured, the first step's
 * reasoning was 2–5k characters and 7–11 s of every beat.
 */
export function writerBeatThinking(
  message: string,
  opts: { base: ThinkingLevel; lastBeatToolError: boolean; config: WriterThinkingConfig },
): { level: ThinkingLevel; reason: ThinkingReason } {
  const { base, config } = opts;
  if (config.mode === 'fixed') return { level: base, reason: 'fixed' };
  if (base === 'off') return { level: 'off', reason: 'base-off' };
  if (opts.lastBeatToolError) return { level: base, reason: 'tool-error' };
  if (message.includes('[Author Request]')) return { level: base, reason: 'authoring' };
  // The layer line is routing, not the player's words: a page called `exit-hall` is not a big beat.
  const request = message.split('\n').filter((line) => !line.startsWith('[Current Layer]')).join('\n');
  if (config.bigBeat.test(request)) return { level: base, reason: 'big-beat' };
  return { level: 'off', reason: 'ordinary' };
}

// ——— §3 landing: the player's beat has a result once the first page change lands ———

/**
 * True when a finished writer tool call put something on the player's page:
 * a chalk, or a `write` / `edit` of a world file (the layer tree). Character
 * memory, player files and failed calls do not count — nothing the player sees
 * has changed yet. Dice, choices and reads never count: after them the writer
 * still owes the narration.
 */
export function isLandingTool(toolName: string, path: unknown, isError: boolean): boolean {
  if (isError) return false;
  if (toolName === 'chalk') return true;
  return (toolName === 'write' || toolName === 'edit') && typeof path === 'string' && /^world\//.test(path.replace(/^\.\//, ''));
}

// ——— §4 compaction: fold old beats into a summary between beats ———

export interface WriterCompactionConfig {
  enabled: boolean;
  /** Compact after a beat once the writer's context is at least this many tokens. */
  at: number;
  /** Recent tokens a compaction keeps verbatim (pi-rp `compaction.keepRecentTokens`). */
  keep: number;
}

export const WRITER_COMPACTION_DEFAULTS: WriterCompactionConfig = { enabled: true, at: 64000, keep: 20000 };

/**
 * `AIRP_WRITER_COMPACT=0` turns it off (the old behaviour: the session only
 * grows); `AIRP_WRITER_COMPACT_AT` / `AIRP_WRITER_COMPACT_KEEP` are token
 * counts. `keep` is clamped below `at`, or every beat would compact.
 */
export function writerCompactionFromEnv(env: NodeJS.ProcessEnv = process.env): WriterCompactionConfig {
  const flag = (env.AIRP_WRITER_COMPACT ?? '').trim().toLowerCase();
  const enabled = !(flag === '0' || flag === 'off' || flag === 'false');
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  const at = num(env.AIRP_WRITER_COMPACT_AT, WRITER_COMPACTION_DEFAULTS.at);
  const keep = Math.min(num(env.AIRP_WRITER_COMPACT_KEEP, WRITER_COMPACTION_DEFAULTS.keep), Math.floor(at / 2));
  return { enabled, at, keep };
}

/**
 * The writer's pi-rp settings overlay (`--settings-file`, read-only, process
 * level). Only compaction: how much a compaction keeps, and a safety-net
 * auto trigger at twice the between-beat threshold for a single runaway beat
 * (deepseek-v4-flash's 1M window would otherwise never trigger one).
 */
export function writerSettingsOverlay(cfg: WriterCompactionConfig): Record<string, unknown> {
  return { compaction: { enabled: true, keepRecentTokens: cfg.keep, thresholdTokens: cfg.at * 2 } };
}

/** True when a settled writer whose context holds `tokens` should compact before the next beat. */
export function compactionDue(tokens: unknown, cfg: WriterCompactionConfig): boolean {
  return cfg.enabled && typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= cfg.at;
}

/** `AIRP_WRITER_EARLY_RELEASE=0` keeps the player waiting until the writer settles (the old behaviour). */
export function earlyReleaseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.AIRP_WRITER_EARLY_RELEASE ?? '').trim().toLowerCase();
  return !(flag === '0' || flag === 'off' || flag === 'false');
}
