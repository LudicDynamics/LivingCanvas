import { track } from './analytics.js';
import type { RollDiceDetails } from '@airp/shared';
import { outcomeOfPayload } from './dice-tier.js';

/**
 * The untrusted transport shape emitted by EventBridge. It is deliberately not
 * the consumer contract: all sources must pass through the canonical ingress
 * below before a ceremony is staged.
 */
export interface DiceFrameVerdict {
  source: 'writer' | 'character';
  characterId?: string;
  timestamp?: string;
  path: string;
  name: string;
  dice: string;
  desc: string;
  expect: string;
  result: number;
  passed: boolean;
  rolls: number[];
  crit: boolean;
  fumble: boolean;
  layer: string | null;
  /**
   * The optional world-command receipt the server attaches to a roll that
   * declared `on.roll_resolved`. RAW wire shape — the
   * projection into a player-readable view is `parseCommandReceipts`'s job at
   * render time, so both aliases below can carry it without re-projecting.
   */
  commands?: unknown;
  /** A skill check's verdict, carried verbatim; the details guard shape-checks it. */
  skill?: unknown;
  /** The shared tier; derived from grade / booleans when an older server omits it. */
  outcome?: unknown;
  /** The tier's consequence summary, carried verbatim (`lib/dice-tier.ts` projects it). */
  consequence?: unknown;
}
/**
 * The sole internal contract consumed by DiceCeremony.
 *
 * `commands` is an OPTIONAL addition: it is carried
 * verbatim, never validated here, and its absence is the normal case for a roll
 * that declared no `on.roll_resolved`. The projection into a player-facing view
 * belongs to `lib/world-command.ts`; the ceremony only knows how to hold it.
 */
export interface DiceCeremonyInput extends RollDiceDetails {
  source: 'player-http' | 'writer-frame' | 'character-frame';
  sourceId: string;
  requestKey: string;
  fingerprint: string;
  /** Allocated by the canonical ingress; never copied from transport data. */
  sourceSeq: number;
  commands?: unknown;
  /** The tier's consequence summary, carried verbatim. */
  consequence?: unknown;
}

export interface CeremonySnapshot {
  /** Canonical input retained for consumers other than the legacy App prop. */
  input: DiceCeremonyInput;
  /** Compatibility alias for App's existing `verdict={snapshot.verdict}` mount. */
  verdict: DiceFrameVerdict;
  key: number;
}

export interface DiceIngressAllocator {
  fingerprint(raw: RollDiceDetails | DiceFrameVerdict, source: DiceCeremonyInput['source']): string;
  allocate(fingerprint: string): { requestKey: string; sourceSeq: number; isDuplicate: boolean };
  reset(): void;
}

const SEEN_TTL_MS = 5000;
const SEEN_LIMIT = 50;
const seen = new Map<string, number>();
const pendingFingerprintByPath = new Map<string, string>();
const inputByFingerprint = new Map<string, DiceCeremonyInput>();
/**
 * The strict guard's output: the twelve authoritative keys, plus the optional
 * world-command receipt when the server sent one (the design notes red
 * line 2 — the rebuild below lists its keys BY HAND, so a field the server adds
 * does not reach `DiceCeremonyInput` unless it is named here).
 */
export interface RollDiceDetailsWithCommands extends RollDiceDetails {
  commands?: unknown;
  consequence?: unknown;
}

const detailsKeys = ['path', 'name', 'dice', 'desc', 'expect', 'result', 'passed', 'rolls', 'crit', 'fumble', 'forged', 'layer'] as const;

/**
 * Absorb the OPTIONAL `commands` receipt without letting it into `detailsKeys`.
 *
 * That array is the REQUIRED-key list (checked with `hasOwn` below), so adding
 * `commands` to it would make every plain roll — the common case — fail the
 * guard, return null, and leave the player staring at "missing authoritative
 * roll details" instead of a ceremony. This is the module's single most
 * dangerous edit (06 §8.2 red line 1); it lives in its own function so the
 * absence of `commands` from that list is visible at the point of use.
 */
function withOptionalCommands(
  details: RollDiceDetails,
  raw: Record<string, unknown>,
): RollDiceDetailsWithCommands {
  // A skill check's verdict rides along the same way: optional, never required
  //.
  const skill = skillOf(raw.skill);
  const withSkill = skill ? { ...details, skill } : details;
  // The tier and its consequence chip ride along the same way.
  const outcome = outcomeOfPayload({ ...raw, ...(skill ? { skill } : {}) }) ?? details.outcome;
  const withTier = { ...withSkill, outcome, ...(isRecord(raw.consequence) ? { consequence: raw.consequence } : {}) };
  return hasOwn(raw, 'commands') ? { ...withTier, commands: raw.commands } : withTier;
}

/** The optional `skill` verdict, shape-checked; anything malformed is dropped. */
function skillOf(raw: unknown): RollDiceDetails['skill'] | undefined {
  if (!isRecord(raw)) return undefined;
  if ((raw.system !== 'coc' && raw.system !== 'dnd') || typeof raw.id !== 'string' || typeof raw.label !== 'string' || typeof raw.tier !== 'string') return undefined;
  if (typeof raw.target !== 'number' || typeof raw.grade !== 'string') return undefined;
  return raw as unknown as RollDiceDetails['skill'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasOwn(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/** Strict guard for an authoritative HTTP details object. */
export function parseRollDiceDetails(raw: unknown): RollDiceDetailsWithCommands | null {
  if (!isRecord(raw)) return null;
  for (const key of detailsKeys) if (!hasOwn(raw, key)) return null;
  if (typeof raw.path !== 'string' || raw.path === '') return null;
  for (const key of ['name', 'dice', 'desc', 'expect'] as const) {
    if (typeof raw[key] !== 'string') return null;
  }
  if (typeof raw.result !== 'number' || !Number.isFinite(raw.result)) return null;
  if (typeof raw.passed !== 'boolean' || typeof raw.crit !== 'boolean' || typeof raw.fumble !== 'boolean') return null;
  if (typeof raw.forged !== 'boolean') return null;
  if (!Array.isArray(raw.rolls) || raw.rolls.length === 0 || !raw.rolls.every((face) => typeof face === 'number' && Number.isFinite(face))) return null;
  if (typeof raw.layer !== 'string' && raw.layer !== null) return null;
  const path = raw.path as string;
  const name = raw.name as string;
  const dice = raw.dice as string;
  const desc = raw.desc as string;
  const expect = raw.expect as string;
  const result = raw.result as number;
  const passed = raw.passed as boolean;
  const rolls = raw.rolls as number[];
  const crit = raw.crit as boolean;
  const fumble = raw.fumble as boolean;
  const forged = raw.forged as boolean;
  const layer = raw.layer as string | null;
  return withOptionalCommands(
    { path, name, dice, desc, expect, result, passed, rolls: [...rolls], crit, fumble, forged, layer, outcome: passed ? (crit ? 'crit_success' : 'success') : (fumble ? 'crit_fail' : 'fail') },
    raw,
  );
}
export function parsePlayerDiceResponse(raw: unknown, httpOk: boolean): RollDiceDetailsWithCommands | null {
  if (!httpOk || !isRecord(raw) || raw.ok !== true) return null;
  const nested = isRecord(raw.details) ? raw.details : raw;
  return parseRollDiceDetails(nested);
}

/**
 * Boundary guard for the writer/character frame. Legacy frames may omit the
 * presentation strings and crit flags; they are normalized to empty/false
 * here, then rejected by the canonical details guard if they enter ingress.
 * Source is required: an unknown source must never be silently treated as writer.
 */
export function parseDiceFrame(raw: unknown): DiceFrameVerdict | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.path !== 'string' || raw.path === '') return null;
  if (typeof raw.result !== 'number' || !Number.isFinite(raw.result)) return null;
  if (typeof raw.passed !== 'boolean') return null;
  if (!Array.isArray(raw.rolls) || raw.rolls.length === 0 || !raw.rolls.every((face) => typeof face === 'number' && Number.isFinite(face))) return null;
  if (typeof raw.layer !== 'string' && raw.layer !== null && raw.layer !== undefined) return null;
  if (raw.source !== 'writer' && raw.source !== 'character') return null;
  if (raw.source === 'character' && (typeof raw.characterId !== 'string' || raw.characterId === '')) return null;
  return {
    source: raw.source === 'character' ? 'character' : 'writer',
    ...(typeof raw.characterId === 'string' ? { characterId: raw.characterId } : {}),
    ...(typeof raw.timestamp === 'string' ? { timestamp: raw.timestamp } : {}),
    path: raw.path,
    name: typeof raw.name === 'string' ? raw.name : '',
    dice: typeof raw.dice === 'string' ? raw.dice : '',
    desc: typeof raw.desc === 'string' ? raw.desc : '',
    expect: typeof raw.expect === 'string' ? raw.expect : '',
    result: raw.result,
    passed: raw.passed,
    rolls: [...(raw.rolls as number[])],
    crit: typeof raw.crit === 'boolean' ? raw.crit : false,
    fumble: typeof raw.fumble === 'boolean' ? raw.fumble : false,
    layer: raw.layer === undefined ? null : raw.layer as string | null,
    // The frame carries the same optional receipt as the HTTP details (§8.1).
    ...(hasOwn(raw, 'commands') ? { commands: raw.commands } : {}),
    ...(isRecord(raw.skill) ? { skill: raw.skill } : {}),
    ...(typeof raw.outcome === 'string' ? { outcome: raw.outcome } : {}),
    ...(isRecord(raw.consequence) ? { consequence: raw.consequence } : {}),
  };
}

export type DiceFrameParseResult =
  | { ok: true; value: DiceFrameVerdict }
  | { ok: false; reason: 'invalid_frame' };

/** Diagnostic adapter for App: malformed transport is distinguishable from a
 * valid frame without making the compatibility parser throw. */
export function parseDiceFrameResult(raw: unknown): DiceFrameParseResult {
  const value = parseDiceFrame(raw);
  return value ? { ok: true, value } : { ok: false, reason: 'invalid_frame' };
}

/**
 * The identity payload behind the dedup fingerprint. `commands` is deliberately
 * EXCLUDED: it describes what a roll caused, not which roll this is, and folding
 * it in would make a re-delivered frame with a re-projected receipt look like a
 * different roll and play a second ceremony.
 */
function stableDetails(raw: RollDiceDetails | DiceFrameVerdict): Record<string, unknown> {
  return {
    path: raw.path,
    name: raw.name,
    dice: raw.dice,
    desc: raw.desc,
    expect: raw.expect,
    result: raw.result,
    passed: raw.passed,
    rolls: raw.rolls,
    crit: raw.crit,
    fumble: raw.fumble,
    forged: 'forged' in raw ? raw.forged : false,
    layer: raw.layer,
    characterId: 'characterId' in raw ? raw.characterId ?? null : null,
    timestamp: 'timestamp' in raw ? raw.timestamp ?? null : null,
  };
}

function hashFingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createAllocator(): DiceIngressAllocator {
  const allocations = new Map<string, { requestKey: string; sourceSeq: number }>();
  let sourceSeqCounter = 0;
  return {
    fingerprint(raw, source) {
      return `${source}:${JSON.stringify(stableDetails(raw))}`;
    },
    allocate(value) {
      const previous = allocations.get(value);
      if (previous) return { ...previous, isDuplicate: true };
      const sourceSeq = ++sourceSeqCounter;
      const next = { requestKey: `dice:${sourceSeq}:${hashFingerprint(value)}`, sourceSeq };
      allocations.set(value, next);
      return { ...next, isDuplicate: false };
    },
    reset() {
      allocations.clear();
      sourceSeqCounter = 0;
    },
  };
}

/** Factory is exported for isolated tests; production uses the singleton. */
export const createDiceIngressAllocator = createAllocator;
/** Singleton allocator: all ingress adapters share one monotonic sequence. */
export const diceIngressAllocator = createAllocator();
export const fingerprint = diceIngressAllocator.fingerprint;
export const allocate = diceIngressAllocator.allocate;

function inputFromDetails(
  details: RollDiceDetails,
  source: DiceCeremonyInput['source'],
  sourceId: string,
  requestKeyPrefix?: string,
  frame?: DiceFrameVerdict,
): DiceCeremonyInput | null {
  const rawFingerprint = diceIngressAllocator.fingerprint(frame ?? details, source);
  const fingerprintValue = requestKeyPrefix ? `${requestKeyPrefix}:${rawFingerprint}` : rawFingerprint;
  const allocation = diceIngressAllocator.allocate(fingerprintValue);
  if (allocation.isDuplicate) return inputByFingerprint.get(fingerprintValue) ?? null;
  const input: DiceCeremonyInput = {
    ...details,
    rolls: [...details.rolls],
    source,
    sourceId: source === 'player-http' ? sourceId : `${sourceId}:${details.path}:${allocation.sourceSeq}`,
    requestKey: requestKeyPrefix ?? allocation.requestKey,
    fingerprint: fingerprintValue,
    sourceSeq: allocation.sourceSeq,
  };
  inputByFingerprint.set(fingerprintValue, input);
  return input;
}

/** Normalize an accepted writer/character verdict into the sole consumer shape. */
export function toDiceCeremonyInput(
  verdict: DiceFrameVerdict,
  source: 'writer-frame' | 'character-frame',
): DiceCeremonyInput | null {
  if (source === 'character-frame' && !verdict.characterId) return null;
  if (verdict.name === '' || verdict.dice === '' || verdict.desc === '' || verdict.expect === '') return null;
  const details = parseRollDiceDetails({ ...verdict, forged: false });
  if (!details) return null;
  const identity = source === 'character-frame' ? verdict.characterId! : 'writer';
  return inputFromDetails(details, source, `${source}:${identity}`, undefined, verdict);
}
/** Normalize an authoritative player response after its domain verdict exists. */
export function ingestPlayerRoll(details: unknown, requestKey: string): DiceCeremonyInput | null {
  if (typeof requestKey !== 'string' || requestKey === '') return null;
  const parsed = parseRollDiceDetails(details);
  if (!parsed) return null;
  const fingerprintValue = `${requestKey}:${diceIngressAllocator.fingerprint(parsed, 'player-http')}`;
  if (inputByFingerprint.has(fingerprintValue)) return null;
  const input = inputFromDetails(parsed, 'player-http', requestKey, requestKey, undefined);
  if (!input) return null;
  stageCeremony(input);
  return input;
}

export function shouldPlayFrame(v: DiceFrameVerdict, currentLayer: string, now = Date.now()): boolean {
  if (v.source === 'character' && !v.characterId) return false;
  if (v.layer !== null && v.layer !== currentLayer) return false;
  const source = v.source === 'character' ? 'character-frame' : 'writer-frame';
  const candidate = diceIngressAllocator.fingerprint(v, source);
  pendingFingerprintByPath.set(v.path, candidate);
  const at = seen.get(candidate) ?? seen.get(v.path);
  if (at !== undefined && now - at < SEEN_TTL_MS) return false;
  return true;
}

/** Register a played frame. The path overload preserves App's existing call. */
export function markPlayed(requestKeyOrPath: string, now = Date.now()): void {
  const candidate = pendingFingerprintByPath.get(requestKeyOrPath);
  const keyToMark = candidate ?? requestKeyOrPath;
  seen.delete(keyToMark);
  seen.set(keyToMark, now);
  while (seen.size > SEEN_LIMIT) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

let snapshot: CeremonySnapshot | null = null;
let key = 0;
const listeners = new Set<() => void>();
function notify(): void { for (const cb of listeners) cb(); }
export function subscribeCeremony(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }
export function getCeremonySnapshot(): CeremonySnapshot | null { return snapshot; }

/**
 * Reveal holds. The server writes a roll into its card before the ceremony has
 * played, so a card must not show the result until that path's ceremony ends —
 * or, when no ceremony arrives, shortly after its request settles.
 */
const holds = new Map<string, ReturnType<typeof setTimeout> | null>();
/** How long a settled request keeps its card hidden waiting for the ceremony frame. */
export const REVEAL_GRACE_MS = 2_000;

function liftHold(path: string): boolean {
  const timer = holds.get(path);
  if (timer) clearTimeout(timer);
  return holds.delete(path);
}

/** Hide a card's roll result from the moment its roll is requested. */
export function holdReveal(path: string): void {
  const timer = holds.get(path);
  if (timer) clearTimeout(timer);
  const had = holds.has(path);
  holds.set(path, null);
  if (!had) notify();
}

/** The request settled: a staged ceremony for the path keeps the hold; otherwise it lifts after a grace period. */
export function settleReveal(path: string, graceMs = REVEAL_GRACE_MS): void {
  if (!holds.has(path) || snapshot?.input.path === path) return;
  const timer = holds.get(path);
  if (timer) clearTimeout(timer);
  if (graceMs <= 0) {
    if (liftHold(path)) notify();
    return;
  }
  holds.set(path, setTimeout(() => { if (liftHold(path)) notify(); }, graceMs));
}

/** True while a card's roll result must stay hidden. */
export function isRevealHeld(path: string): boolean {
  return holds.has(path) || snapshot?.input.path === path;
}

/**
 * A tumbling face for `index` at `tick`. `faces` is the declared die's face
 * count: without it the old `value > 6`
 * guess made `1d20` tumble through 53 — a face the die cannot show, seconds
 * before it lands on 12. Callers with only a face value keep the old behaviour,
 * so the guess survives exactly where nothing better is known.
 */
export function rollingFace(index: number, tick: number, value: number, faces?: number): number {
  const ceiling = faces !== undefined && faces >= 2 ? Math.min(faces, 1000) : value > 6 ? 100 : 6;
  return ((index * 7 + tick * 13) % ceiling) + 1;
}
export function stageCeremony(input: DiceCeremonyInput, legacyVerdict?: DiceFrameVerdict): boolean {
  key += 1;
  // A replaced ceremony can no longer release its own card.
  const previous = snapshot?.input.path;
  if (previous !== undefined && previous !== input.path) liftHold(previous);
  // The ceremony now owns this card's hold until it ends.
  if (holds.has(input.path)) {
    const timer = holds.get(input.path);
    if (timer) clearTimeout(timer);
    holds.set(input.path, null);
  }
  const frame: DiceFrameVerdict = legacyVerdict ?? {
    source: input.source === 'character-frame' ? 'character' : 'writer',
    path: input.path,
    name: input.name,
    dice: input.dice,
    desc: input.desc,
    expect: input.expect,
    result: input.result,
    passed: input.passed,
    rolls: [...input.rolls],
    crit: input.crit,
    fumble: input.fumble,
    layer: input.layer,
    // Red line 3 (06 §8.2): this rebuild lists its keys BY HAND, and App mounts
    // the ceremony through `verdict={ceremony.verdict}` — a `commands` omitted
    // here disappears silently on the legacy alias path.
    ...(input.commands === undefined ? {} : { commands: input.commands }),
  };
  snapshot = { input, verdict: frame, key };
  notify();
  // 改进产品 (lib/analytics.ts): a roll happened and how it came out — never the check's text.
  track('dice_roll', { outcome: frame.crit ? 'crit' : frame.fumble ? 'fumble' : frame.passed === true ? 'pass' : frame.passed === false ? 'fail' : 'rolled' });
  return true;
}

/** Legacy App entry point: normalize before staging, retaining its mount API. */
export function playCeremony(verdict: DiceFrameVerdict): void {
  const source = verdict.source === 'character' ? 'character-frame' : 'writer-frame';
  const input = toDiceCeremonyInput(verdict, source);
  if (input) stageCeremony(input, verdict);
}

export function clearCeremony(): void {
  if (snapshot === null) return;
  liftHold(snapshot.input.path);
  snapshot = null;
  notify();
}

export function resetSeenForTest(): void {
  seen.clear();
  pendingFingerprintByPath.clear();
  inputByFingerprint.clear();
  diceIngressAllocator.reset();
  for (const path of [...holds.keys()]) liftHold(path);
  snapshot = null;
  key = 0;
}
