import { createContext, createElement, useContext, type ReactNode } from 'react';
import { AirpRequestError } from './airp-gateway.js';

export const ACTION_FEEDBACK_STATUSES = ['accepted', 'conflict', 'rejected', 'failed'] as const;
export type ActionFeedbackStatus = (typeof ACTION_FEEDBACK_STATUSES)[number];
export type ActionFeedbackOutcome = ActionFeedbackStatus | 'pending' | 'cancelled';
export type ActionVerb = 'inspect' | 'act' | 'enter' | 'choice' | 'dice' | 'present' | 'move' | 'take' | 'drop' | 'cancel';
export type ActionFeedbackStage = 'intent' | 'authority' | 'reconcile' | 'presentation' | 'settled';
export type ReconcileStatus = 'not-required' | 'pending' | 'confirmed' | 'failed';

/** A local action identity. This is never sent as an HTTP/WS payload. */
export interface ActionIntent {
  worldId: string;
  projection: string;
  verb: ActionVerb;
  source: string;
  item?: string;
  target?: string;
  from?: string;
  to?: string;
  near?: string;
  layer?: string;
  choice?: string | number;
  cardPath?: string;
  x?: number;
  y?: number;
}

/** Local projection only; this module never creates or replaces a world event. */
export interface ActionFeedback<TDetails = unknown> {
  /** One attempt only. A terminal feedback cannot be settled twice. */
  key: string;
  /** Canonical identity shared by all UI sources for this intent. */
  intentKey: string;
  /** Explicit local retry count, never a server sequence. */
  attempt: number;
  worldId: string;
  projection: string;
  scope: string;
  stage: ActionFeedbackStage;
  outcome: ActionFeedbackOutcome;
  /** Null while pending or cancelled; a terminal action status otherwise. */
  status: ActionFeedbackStatus | null;
  /** Always present so UI does not infer copy from HTTP status or exceptions. */
  message: string;
  /** Authoritative gateway details, when returned. */
  details: TDetails | null;
  /** Authoritative event id, when details include an event. */
  eventId?: string;
  reconcile: ReconcileStatus;
  canRetry: boolean;
  /** Presentation is an admission, never evidence of a world change. */
  presentation: 'none' | 'eligible' | 'played' | 'suppressed';
  /** Compatibility with UX phase vocabulary. */
  phase: 'pending' | 'succeeded' | 'conflict' | 'failed' | 'cancelled';
}

export interface ActionFeedbackStart {
  key: string;
  verb: ActionVerb;
  target?: string;
  intentKey?: string;
  attempt?: number;
  worldId?: string;
  projection?: string;
  scope?: string;
}

export type ActionResultLike<TDetails = unknown> =
  | ({ ok: true; details?: TDetails; eventId?: string } & Record<string, unknown>)
  | ({ ok: false; code?: string; error?: unknown; details?: unknown } & Record<string, unknown>)
  | { cancelled: true };
export interface ReconcileReceipt {
  status: 'confirmed' | 'not-required';
  source: 'details.event' | 'world-event' | 'layer-refresh' | 'chrome-refresh' | 'nook-refresh';
  projection: string;
}

export type ActionRequestResolver = <TDetails = unknown>(intent: ActionIntent, signal: AbortSignal) => Promise<ActionResultLike<TDetails>>;

export interface ActionFeedbackCoordinator {
  begin(intent: ActionIntent): ActionFeedback;
  readonly worldId: string;
  executeIntent<TDetails>(
    intent: ActionIntent,
    reconcile: (details: TDetails, signal: AbortSignal) => Promise<ReconcileReceipt>,
  ): Promise<ActionFeedback<TDetails>>;
  execute<TDetails>(
    intent: ActionIntent,
    request: (signal: AbortSignal) => Promise<ActionResultLike<TDetails>>,
    reconcile: (details: TDetails, signal: AbortSignal) => Promise<ReconcileReceipt>,
  ): Promise<ActionFeedback<TDetails>>;
  cancel(key: string, reason: 'gesture' | 'projection-change' | 'world-change'): ActionFeedback;
  retry(key: string): Promise<ActionFeedback>;
  get(key: string): ActionFeedback | null;
  subscribe(listener: () => void): () => void;
  reset(worldId: string): void;
}

const CONFLICT_CODES = new Set([
  'requirements_not_met', 'wrong_item', 'already_open', 'not_ready', 'no_handler',
  'choice_not_found', 'not_interactive', 'dice_already_rolled', 'already_exists',
  'not_movable', 'near_out_of_layer', 'no_free_seat', 'stale', 'conflict',
  // World-command refusals that mean "the world said no":
  // without these the fallback below reports a misleading red "execution failed"
  // for what is really "this was already settled" or "a rule is missing".
  'command_reused', 'command_not_found', 'command_malformed', 'command_invalid',
  'command_target_missing', 'command_limit_exceeded', 'on_malformed',
  'param_invalid', 'when_malformed', 'facts_unavailable', 'on_from_missing_key',
  'on_from_not_a_list', 'on_from_empty_list', 'on_entry_unavailable',
  'on_entry_not_bound', 'choice_actions_conflict', 'limit_exceeded',
  'command_resume_drifted',
]);
const REJECTED_CODES = new Set([
  'forbidden', 'permission_denied', 'unauthorized', 'not_allowed', 'rejected',
  'dice_forced_not_allowed',
  // The one command refusal that is a permission answer, not a state conflict.
  'command_not_allowed',
]);
const FAILED_CODES = new Set([
  'invalid_argument', 'invalid_path', 'internal', 'not_found', 'unsupported', 'timeout',
  // The world changed and then broke part-way — genuinely a failure.
  'effect_failed', 'command_effect_failed', 'command_write_failed',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function errorCode(value: unknown): string | undefined {
  const item = record(value);
  const payload = record(item?.payload);
  const nested = record(item?.error);
  const nestedPayload = record(nested?.payload);
  const candidate = item?.code ?? payload?.code ?? nested?.code ?? nestedPayload?.code;
  return typeof candidate === 'string' ? candidate : undefined;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;
  const item = record(value);
  if (typeof item?.message === 'string' && item.message) return item.message;
  if (item?.error instanceof Error && item.error.message) return item.error.message;
  if (typeof item?.error === 'string' && item.error) return item.error;
  return 'The action could not be completed.';
}

function errorStatus(value: unknown): number | undefined {
  if (value instanceof AirpRequestError) return value.status;
  const item = record(value);
  const payload = record(item?.payload);
  const nested = record(item?.error);
  const candidate = item?.status ?? item?.statusCode ?? item?.httpStatus ?? payload?.status
    ?? nested?.status ?? nested?.statusCode ?? nested?.httpStatus;
  return typeof candidate === 'number' ? candidate : undefined;
}

/** Extract both gateway success shapes: `{ ok: true, ...details }` and `{ ok: true, details }`. */
export function actionDetailsOf<TDetails = Record<string, unknown>>(result: ActionResultLike<TDetails>): TDetails | null {
  if (!result || ('cancelled' in result && result.cancelled === true) || !('ok' in result) || result.ok !== true) return null;
  if ('details' in result) {
    const nested = record(result.details);
    return nested && Object.keys(nested).length > 0 ? result.details as TDetails : null;
  }
  const flat = { ...result } as Record<string, unknown>;
  delete flat.ok;
  delete flat.eventId;
  return Object.keys(flat).length === 0 ? null : flat as TDetails;
}

function eventIdOf(details: unknown, result: unknown): string | undefined {
  const detail = record(details);
  const event = record(detail?.event);
  const top = record(result);
  const id = detail?.eventId ?? event?.id ?? top?.eventId;
  return typeof id === 'string' ? id : undefined;
}

function validDetails(verb: ActionVerb, details: unknown): boolean {
  const value = record(details);
  if (!value) return false;
  if (verb === 'present') return typeof value.handled === 'boolean';
  if (verb === 'choice') {
    if (typeof value.choice === 'string' && Number.isInteger(value.index)) return true;
    return record(value.action) !== null;
  }
  if (verb === 'enter') {
    if (value.sameLayer === true && typeof value.layer === 'string') return true;
    return typeof value.layer === 'string' && typeof value.name === 'string'
      && typeof value.first === 'boolean' && record(value.event) !== null
      && record(value.followers) !== null;
  }
  if (verb === 'dice') return typeof value.result === 'number' && typeof value.passed === 'boolean';
  if (verb === 'move' || verb === 'take' || verb === 'drop') {
    if (typeof value.path === 'string' && typeof value.from === 'string' && typeof value.to === 'string') return true;
    if (typeof value.path === 'string' && typeof value.x === 'number' && typeof value.y === 'number') return true;
    // arrangeCards returns `{ path, cards: [{ path, x, y, ... }] }`.
    return typeof value.path === 'string' && Array.isArray(value.cards);
  }
  return Object.keys(value).length > 0;
}

/** Classify domain outcomes code/details-first, never by success copy or HTTP 2xx alone. */
export function classifyActionResult(verb: ActionVerb, result: ActionResultLike): ActionFeedbackStatus | 'cancelled' {
  if ('cancelled' in result && result.cancelled === true) return 'cancelled';
  if (!('ok' in result) || result.ok !== true) {
    const code = errorCode(result);
    const status = errorStatus(result);
    if (code && FAILED_CODES.has(code)) return 'failed';
    if (code && REJECTED_CODES.has(code)) return 'rejected';
    if (status === 401 || status === 403) return 'rejected';
    if (code && CONFLICT_CODES.has(code)) return 'conflict';
    if (status === 409) return 'conflict';
    return 'failed';
  }
  const details = actionDetailsOf(result);
  if (!details || !validDetails(verb, details)) return 'failed';
  const detail = record(details)!;
  const code = typeof detail.code === 'string' ? detail.code : undefined;
  if (code && FAILED_CODES.has(code)) return 'failed';
  if (verb === 'present' && detail.handled === false) return 'conflict';
  if (detail.status === 'conflict' || detail.outcome === 'conflict') return 'conflict';
  if (detail.status === 'rejected' || detail.outcome === 'rejected' || detail.accepted === false) return 'rejected';
  if (detail.status === 'failed' || detail.outcome === 'failed') return 'failed';
  if (code && CONFLICT_CODES.has(code)) return 'conflict';
  if (code && REJECTED_CODES.has(code)) return 'rejected';
  // A failed dice check is still an accepted, persisted action fact.
  return 'accepted';
}

function phaseOf(outcome: ActionFeedbackOutcome): ActionFeedback['phase'] {
  if (outcome === 'accepted') return 'succeeded';
  if (outcome === 'rejected') return 'failed';
  return outcome;
}

function messageOf(status: ActionFeedbackStatus | 'cancelled', result: ActionResultLike): string {
  if (status === 'cancelled') return 'Action cancelled.';
  if ('ok' in result && result.ok === true) {
    const detail = record(actionDetailsOf(result));
    if (status === 'conflict' && typeof detail?.reason === 'string') return detail.reason;
    if (status === 'rejected') return 'You are not allowed to do that.';
    return status === 'accepted' ? 'Action accepted.' : 'The action was not accepted.';
  }
  const code = errorCode(result);
  if (code === 'requirements_not_met') return 'That requirement is not met.';
  if (code === 'choice_not_found' || code === 'stale') return 'That choice is no longer available.';
  if (code === 'dice_already_rolled') return 'This roll has already been resolved.';
  if (code === 'wrong_item' || code === 'already_open' || code === 'not_ready' || code === 'no_handler') return 'That action has no effect here.';
  if (status === 'conflict') return 'The action conflicts with the current world state.';
  if (status === 'rejected') return 'You are not allowed to do that.';
  return errorMessage(result);
}

function patchForResult<TDetails>(current: ActionFeedback, verb: ActionVerb, result: ActionResultLike<TDetails>, stage: ActionFeedbackStage, reconcile: ReconcileStatus): ActionFeedback<TDetails> {
  const outcome = classifyActionResult(verb, result);
  const details = actionDetailsOf(result);
  const eventId = eventIdOf(details, result);
  return {
    ...current,
    stage,
    outcome,
    status: outcome === 'cancelled' ? null : outcome,
    message: messageOf(outcome, result),
    details,
    ...(eventId ? { eventId } : {}),
    reconcile,
    canRetry: outcome === 'failed' && errorCode(result) !== 'timeout',
    presentation: 'none',
    phase: phaseOf(outcome),
  } as ActionFeedback<TDetails>;
}

export class ActionFeedbackStore {
  private readonly entries = new Map<string, ActionFeedback>();
  private readonly verbs = new Map<string, ActionVerb>();
  private readonly listeners = new Set<() => void>();

  begin(input: ActionFeedbackStart): ActionFeedback {
    if (!input.key.trim()) throw new Error('Action feedback key must not be empty');
    const existing = this.entries.get(input.key);
    if (existing) return existing;
    const feedback: ActionFeedback = {
      key: input.key,
      intentKey: input.intentKey ?? input.key,
      attempt: input.attempt ?? 0,
      worldId: input.worldId ?? '',
      projection: input.projection ?? '',
      scope: input.scope ?? input.target ?? input.key,
      stage: 'intent',
      outcome: 'pending',
      status: null,
      message: 'Working…',
      details: null,
      reconcile: 'not-required',
      canRetry: false,
      presentation: 'none',
      phase: 'pending',
    };
    this.entries.set(input.key, feedback);
    this.verbs.set(input.key, input.verb);
    this.emit();
    return feedback;
  }
  authorityStarted(key: string): ActionFeedback {
    const current = this.entries.get(key);
    if (!current) throw new Error(`Unknown action feedback key: ${key}`);
    if (current.stage !== 'intent') return current;
    const feedback = { ...current, stage: 'authority' as const };
    this.entries.set(key, feedback);
    this.emit();
    return feedback;
  }

  /** Complete a legacy one-stage action. Coordinator uses the staged helpers below. */
  settle<TDetails = unknown>(key: string, result: ActionResultLike<TDetails>): ActionFeedback<TDetails> {
    const current = this.entries.get(key);
    if (!current) throw new Error(`Unknown action feedback key: ${key}`);
    if (current.stage === 'settled') return current as ActionFeedback<TDetails>;
    const feedback = patchForResult(current, this.verbs.get(key) ?? 'act', result, 'settled', 'not-required');
    this.entries.set(key, feedback);
    this.emit();
    return feedback;
  }

  authority<TDetails = unknown>(key: string, result: ActionResultLike<TDetails>): ActionFeedback<TDetails> {
    const current = this.entries.get(key);
    if (!current) throw new Error(`Unknown action feedback key: ${key}`);
    if (current.stage === 'settled') return current as ActionFeedback<TDetails>;
    const outcome = classifyActionResult(this.verbs.get(key) ?? 'act', result);
    const feedback = patchForResult(current, this.verbs.get(key) ?? 'act', result,
      outcome === 'accepted' ? 'reconcile' : 'settled', outcome === 'accepted' ? 'pending' : 'not-required');
    this.entries.set(key, feedback);
    this.emit();
    return feedback;
  }

  confirm<TDetails = unknown>(key: string, receipt: ReconcileReceipt): ActionFeedback<TDetails> {
    const current = this.entries.get(key);
    if (!current) throw new Error(`Unknown action feedback key: ${key}`);
    if (current.stage === 'settled') return current as ActionFeedback<TDetails>;
    if (current.outcome !== 'accepted') return current as ActionFeedback<TDetails>;
    const feedback = {
      ...current,
      stage: 'settled' as const,
      reconcile: receipt.status,
      message: 'Action confirmed and the scene is synchronized.',
      // Silent: the scene change itself is the feedback. A toast after every
      // confirmed action was noise; only failures speak.
      presentation: 'suppressed' as const,
      phase: 'succeeded' as const,
    } as ActionFeedback<TDetails>;
    this.entries.set(key, feedback);
    this.emit();
    return feedback;
  }

  failReconcile<TDetails = unknown>(key: string, message = 'The action was accepted, but the result could not be confirmed.'): ActionFeedback<TDetails> {
    const current = this.entries.get(key);
    if (!current) throw new Error(`Unknown action feedback key: ${key}`);
    if (current.stage === 'settled') return current as ActionFeedback<TDetails>;
    const feedback = {
      ...current,
      stage: 'settled' as const,
      outcome: 'failed' as const,
      status: 'failed' as const,
      reconcile: 'failed' as const,
      message,
      canRetry: false,
      presentation: 'suppressed' as const,
      phase: 'failed' as const,
    } as ActionFeedback<TDetails>;
    this.entries.set(key, feedback);
    this.emit();
    return feedback;
  }

  cancel(key: string): ActionFeedback {
    const current = this.entries.get(key);
    if (!current) throw new Error(`Unknown action feedback key: ${key}`);
    if (current.stage === 'settled') return current;
    const feedback: ActionFeedback = { ...current, stage: 'settled', outcome: 'cancelled', status: null, message: 'Action cancelled.', canRetry: false, reconcile: 'not-required', presentation: 'suppressed', phase: 'cancelled' };
    this.entries.set(key, feedback);
    this.emit();
    return feedback;
  }

  get(key: string): ActionFeedback | null { return this.entries.get(key) ?? null; }

  reset(): void { this.entries.clear(); this.verbs.clear(); this.emit(); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}

interface ExecutionRecord {
  intent: ActionIntent;
  key: string;
  attempt: number;
  request: (signal: AbortSignal) => Promise<ActionResultLike<unknown>>;
  reconcile: (details: unknown, signal: AbortSignal) => Promise<ReconcileReceipt>;
  controller: AbortController;
  promise?: Promise<ActionFeedback<unknown>>;
}

export const ACTION_FEEDBACK_TIMEOUT_MS = 15_000;

function normalized(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\\/g, '/').replace(/\s+/g, ' ') : '';
}
function normalizedChoice(value: string | number | undefined): string {
  return typeof value === 'number' ? `index:${Number.isInteger(value) ? value : String(value)}` : `label:${normalized(value)}`;
}

/** Source-independent canonical key shared by layer, Nook, keyboard and button. */
export function canonicalActionKey(intent: ActionIntent): string {
  const world = normalized(intent.worldId);
  const projection = normalized(intent.projection);
  if (!world || !projection) throw new Error('An active world and projection are required for an action.');
  let operands: string;
  switch (intent.verb) {
    case 'choice': operands = `path:${normalized(intent.target ?? intent.item)}|choice:${normalizedChoice(intent.choice)}`; break;
    case 'present': operands = `item:${normalized(intent.item)}|target:${normalized(intent.target)}`; break;
    case 'move':
      operands = intent.cardPath
        ? `card-position:${normalized(intent.cardPath)}|x:${String(intent.x ?? '')}|y:${String(intent.y ?? '')}`
        : `from:${normalized(intent.from ?? intent.item)}|to:${normalized(intent.to ?? intent.target)}|near:${normalized(intent.near)}`;
      break;
    case 'take':
    case 'drop': operands = `from:${normalized(intent.from ?? intent.item)}|to:${normalized(intent.to ?? intent.target)}|near:${normalized(intent.near)}`; break;
    case 'enter': operands = `layer:${normalized(intent.layer ?? intent.target)}`; break;
    default: operands = `target:${normalized(intent.target ?? intent.item)}|card:${normalized(intent.cardPath)}|x:${String(intent.x ?? '')}|y:${String(intent.y ?? '')}`;
  }
  return `${world}|${projection}|${intent.verb}|${operands}`;
}

function actionScopeOf(intent: ActionIntent): string {
  const subject = normalized(intent.item ?? intent.from ?? intent.target ?? intent.layer ?? intent.cardPath);
  const family = intent.verb === 'present' ? 'present-target' : intent.verb === 'enter' ? 'enter-layer' : intent.verb === 'choice' ? 'choice' : intent.verb === 'move' || intent.verb === 'take' || intent.verb === 'drop' ? 'item' : intent.verb;
  return `${normalized(intent.worldId)}|${normalized(intent.projection)}|${family}|${subject}`;
}

class ActionFeedbackCoordinatorImpl implements ActionFeedbackCoordinator {
  private readonly store = new ActionFeedbackStore();
  private readonly byIntent = new Map<string, string>();
  private readonly records = new Map<string, ExecutionRecord>();
  private readonly scopes = new Map<string, string>();
  private activeWorldId = '';
  private readonly requestResolver?: ActionRequestResolver;

  constructor(requestResolver?: ActionRequestResolver) {
    this.requestResolver = requestResolver;
  }

  get worldId(): string { return this.activeWorldId; }

  begin(intent: ActionIntent): ActionFeedback {
    this.activeWorldId = intent.worldId;
    const intentKey = canonicalActionKey(intent);
    const existingKey = this.byIntent.get(intentKey);
    const existing = existingKey ? this.store.get(existingKey) : null;
    // Only an action still in flight is deduped (a double-click, the keyboard and
    // the button at once). A settled one — refusal OR success — answered the
    // world as it was: the player may have changed it since (a locked gate, then
    // the item picked up), or come back to do it again (enter a place, go back
    // out, enter it again — deduping the settled success made every second
    // entry silently do nothing). A new gesture is a new attempt.
    if (existing && existing.stage !== 'settled') return existing;
    const scope = actionScopeOf(intent);
    const scopedKey = this.scopes.get(scope);
    const scoped = scopedKey ? this.store.get(scopedKey) : null;
    if (scoped && scoped.stage !== 'settled') return scoped;
    const attempt = existing ? existing.attempt + 1 : 0;
    const key = `${intentKey}:attempt:${attempt}`;
    this.byIntent.set(intentKey, key);
    this.scopes.set(scope, key);
    return this.store.begin({ key, intentKey, attempt, verb: intent.verb, target: intent.target, worldId: intent.worldId, projection: intent.projection, scope });
  }
  executeIntent<TDetails>(intent: ActionIntent, reconcile: (details: TDetails, signal: AbortSignal) => Promise<ReconcileReceipt>): Promise<ActionFeedback<TDetails>> {
    if (!this.requestResolver) {
      return Promise.resolve(this.store.settle(this.begin(intent).key, { ok: false, code: 'unavailable', error: 'No action request resolver is configured.' }));
    }
    return this.execute(intent, signal => this.requestResolver!<TDetails>(intent, signal), reconcile);
  }

  execute<TDetails>(intent: ActionIntent, request: (signal: AbortSignal) => Promise<ActionResultLike<TDetails>>, reconcile: (details: TDetails, signal: AbortSignal) => Promise<ReconcileReceipt>): Promise<ActionFeedback<TDetails>> {
    const intentKey = canonicalActionKey(intent);
    const initial = this.begin(intent);
    if (initial.intentKey !== intentKey) return Promise.resolve(initial as ActionFeedback<TDetails>);
    const key = initial.key;
    const prior = this.records.get(key);
    if (prior?.promise) return prior.promise as Promise<ActionFeedback<TDetails>>;
    const controller = new AbortController();
    const execution: ExecutionRecord = {
      intent,
      key,
      attempt: initial.attempt,
      request: signal => request(signal) as Promise<ActionResultLike<unknown>>,
      reconcile: (details, signal) => reconcile(details as TDetails, signal),
      controller,
    };
    this.records.set(key, execution);
    const promise = this.run(execution) as Promise<ActionFeedback<TDetails>>;
    execution.promise = promise as Promise<ActionFeedback<unknown>>;
    return promise;
  }

  private async run(execution: ExecutionRecord): Promise<ActionFeedback<unknown>> {
    const { key, controller } = execution;
    let timeoutId: Parameters<typeof clearTimeout>[0] = 0;
    const timer = new Promise<ActionResultLike<unknown>>(resolve => {
      timeoutId = setTimeout(() => resolve({ ok: false, code: 'timeout', error: 'Action result still needs checking.' }), ACTION_FEEDBACK_TIMEOUT_MS);
    });
    this.store.authorityStarted(key);
    const requestPromise = Promise.resolve().then(() => execution.request(controller.signal));
    let result: ActionResultLike<unknown>;
    try { result = await Promise.race([requestPromise, timer]); }
    catch (error) { result = { ok: false, error }; }
    clearTimeout(timeoutId);
    const existing = this.store.get(key);
    if (!existing) {
      return {
        key,
        intentKey: canonicalActionKey(execution.intent),
        attempt: execution.attempt,
        worldId: execution.intent.worldId,
        projection: execution.intent.projection,
        scope: actionScopeOf(execution.intent),
        stage: 'settled',
        outcome: 'failed',
        status: 'failed',
        message: 'This action belongs to an older world.',
        details: null,
        reconcile: 'failed',
        canRetry: false,
        presentation: 'suppressed',
        phase: 'failed',
      };
    }
    const authority = this.store.authority(key, result);
    if (authority.stage === 'settled' || authority.outcome !== 'accepted') {
      this.releaseScope(execution);
      return authority;
    }
    const details = authority.details;
    if (details === null) {
      this.releaseScope(execution);
      return this.store.failReconcile(key);
    }
    try {
      const receipt = await execution.reconcile(details, controller.signal);
      const current = this.store.get(key);
      if (!current || current.stage === 'settled' || current.worldId !== execution.intent.worldId) return (current ?? authority);
      const confirmed = this.store.confirm(key, receipt);
      this.releaseScope(execution);
      return confirmed;
    } catch {
      const failed = this.store.failReconcile(key);
      this.releaseScope(execution);
      return failed;
    }
  }

  cancel(key: string, _reason: 'gesture' | 'projection-change' | 'world-change'): ActionFeedback {
    const current = this.store.get(key);
    if (!current) throw new Error(`Unknown action feedback key: ${key}`);
    const execution = this.records.get(key);
    if (execution && current.stage !== 'settled') {
      execution.controller.abort();
      const feedback = current.stage === 'intent' ? this.store.cancel(key) : this.store.failReconcile(key, 'The action was sent; its result still needs checking.');
      this.releaseScope(execution);
      return feedback;
    }
    return this.store.cancel(key);
  }

  async retry(key: string): Promise<ActionFeedback> {
    const current = this.store.get(key);
    const old = this.records.get(key);
    if (!current || !old || !current.canRetry) {
      if (current) return current;
      throw new Error(`Unknown action feedback key: ${key}`);
    }
    const nextKey = `${current.intentKey}:attempt:${current.attempt + 1}`;
    const next = this.store.begin({ key: nextKey, intentKey: current.intentKey, attempt: current.attempt + 1, verb: old.intent.verb, target: old.intent.target, worldId: old.intent.worldId, projection: old.intent.projection, scope: actionScopeOf(old.intent) });
    this.byIntent.set(current.intentKey, nextKey);
    return this.executeWithKey(next, old);
  }

  private executeWithKey(feedback: ActionFeedback, old: ExecutionRecord): Promise<ActionFeedback> {
    const controller = new AbortController();
    const next: ExecutionRecord = { ...old, key: feedback.key, attempt: feedback.attempt, controller, promise: undefined };
    this.records.set(feedback.key, next);
    const promise = this.run(next);
    next.promise = promise;
    return promise;
  }

  private releaseScope(execution: ExecutionRecord): void {
    const scope = actionScopeOf(execution.intent);
    if (this.scopes.get(scope) === execution.key) this.scopes.delete(scope);
  }

  get(key: string): ActionFeedback | null { return this.store.get(key); }
  subscribe(listener: () => void): () => void { return this.store.subscribe(listener); }
  reset(worldId: string): void {
    for (const execution of this.records.values()) if (execution.intent.worldId !== worldId) execution.controller.abort();
    this.byIntent.clear();
    this.records.clear();
    this.scopes.clear();
    this.activeWorldId = worldId;
    this.store.reset();
  }
}

export function createActionFeedbackCoordinator(requestResolver?: ActionRequestResolver): ActionFeedbackCoordinator {
  return new ActionFeedbackCoordinatorImpl(requestResolver);

}
export function beginAction(store: ActionFeedbackStore, input: ActionFeedbackStart): ActionFeedback { return store.begin(input); }

export async function runAction<TDetails = unknown>(store: ActionFeedbackStore, input: ActionFeedbackStart, request: () => Promise<ActionResultLike<TDetails>>): Promise<ActionFeedback<TDetails>> {
  store.begin(input);
  try { return await store.settle(input.key, await request()); }
  catch (error) { return store.settle(input.key, { ok: false, error }); }
}

const ActionFeedbackContext = createContext<ActionFeedbackCoordinator | null>(null);
export function ActionFeedbackProvider({ coordinator, children }: { coordinator: ActionFeedbackCoordinator; children: ReactNode }) {
  return createElement(ActionFeedbackContext.Provider, { value: coordinator }, children);
}
/** Compatibility key for the dice presentation's local identity; world actions use canonicalActionKey. */
export function actionKey(verb: ActionVerb, target: string, detail = ''): string {
  return `${verb}:${target.trim()}:${detail.trim()}`;
}

export function useActionFeedback(): ActionFeedbackCoordinator | null { return useContext(ActionFeedbackContext); }
