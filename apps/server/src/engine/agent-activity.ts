import path from 'node:path';

export type ActivitySource = 'writer' | 'character' | 'functional';
export type ActivityOperation =
  | 'read' | 'create' | 'write' | 'edit' | 'delete' | 'move'
  | 'use' | 'look' | 'roll' | 'choose' | 'initialize' | 'memory' | 'other';

export interface AgentActivityFrame {
  type: 'agent_activity';
  source: ActivitySource;
  agentId: string;
  turnId: string;
  activityId: string;
  phase: 'started' | 'completed' | 'failed';
  operation: ActivityOperation;
  subject?: string;
  toolName?: string;
  error?: string;
  timestamp: string;
}

export interface ActivityTurnContext {
  source: ActivitySource;
  agentId: string;
  turnId: string;
}

export interface ChildActivityEnvelope {
  type: 'tool_start' | 'tool_end';
  context: ActivityTurnContext;
  toolCallId: string;
  toolName: string;
  args?: unknown;
  details?: unknown;
  isError?: boolean;
  errorKind?: 'tool_error' | 'timeout' | 'cancelled' | 'agent_stopped';
}

const TOOL_OPERATION: Record<string, ActivityOperation> = {
  look_at: 'look', view_canvas: 'look', read: 'read',
  write: 'write', chalk: 'write', create_file: 'write', edit: 'edit',
  delete: 'delete', move: 'move', move_to: 'move', rename: 'move',
  choose: 'choose', choose_option: 'choose', roll_dice: 'roll',
  use_item: 'use', use_item_on: 'use', show: 'use', get_component: 'use',
  link: 'edit', arrange: 'edit', set_following: 'edit', generate_image: 'create',
  set_music: 'edit',
  subagent: 'use', subagent_profiles: 'use', 'airp-init': 'initialize',
  'scene-init': 'initialize', 'nook-init': 'initialize',
  // Memory tools (vendor/pi-rp .../memory/src/module.ts:158-170, 12 names).
  // Operation only — NO SUBJECT_FIELDS rows: memory args carry URIs and raw
  // content that must never reach the wire (see sanitizeActivitySubject).
  recall: 'memory', retrieve: 'memory', memorize: 'memory', revise: 'memory',
  forget: 'memory', relocate: 'memory', associate: 'memory', trigger: 'memory',
  consolidate: 'memory', retrace: 'memory', set_time: 'memory', awaken: 'memory',
};

const SUBJECT_FIELDS: Record<string, string[]> = {
  look_at: ['path', 'name'], view_canvas: ['path', 'name'], read: ['path'],
  write: ['path', 'name'], chalk: ['path', 'name'], create_file: ['path', 'name'],
  edit: ['path', 'name'], delete: ['path', 'name'],
  move: ['from', 'to', 'path'], move_to: ['from', 'to', 'path'], rename: ['from', 'to', 'path'],
  choose: ['name', 'path'], choose_option: ['name', 'path'], roll_dice: ['name', 'path'],
  use_item: ['itemName', 'targetName'], use_item_on: ['itemName', 'targetName'],
  show: ['component', 'target'], get_component: ['component', 'target'],
  link: ['path', 'layer', 'name'], arrange: ['path', 'layer', 'name'], set_following: ['path', 'layer', 'name'],
  set_music: ['layer', 'track'],
  generate_image: ['name', 'path'], subagent: ['profileId'], subagent_profiles: ['profileId'],
  'airp-init': ['target'], 'scene-init': ['target'], 'nook-init': ['target'],
};

const KNOWN_TOOL_NAMES = new Set(Object.keys(TOOL_OPERATION));
const SAFE_PROFILE_IDS = new Set(['scene-init', 'nook-init']);
const MAX_TEXT = 80;

export function normalizeActivityOperation(toolName: string): ActivityOperation {
  return TOOL_OPERATION[toolName] ?? 'other';
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function safeText(value: string, cwd?: string): string | undefined {
  let text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[?#].*$/, '').trim();
  if (!text || text.includes('{') || text.includes('}') || text.includes('"')) return undefined;
  const isPath = text.includes('/') || text.includes('\\') || /^\.?\.?[\\/]/.test(text) || /^[A-Za-z]:/.test(text);
  if (isPath) {
    text = text.replaceAll('\\', '/');
    if (cwd && path.isAbsolute(text) && path.isAbsolute(cwd)) {
      const relative = path.relative(cwd, text).replaceAll('\\', '/');
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) text = relative;
      else text = path.posix.basename(text);
    }
    if (path.posix.isAbsolute(text) || /^[A-Za-z]:\//.test(text)) text = path.posix.basename(text);
    const parts = text.split('/').filter((part) => part && part !== '.' && part !== '..');
    if (!parts.length) return undefined;
    text = parts.join('/');
    text = text.replace(/\.(?:md|markdown|txt|json|yaml|yml)$/i, '');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const chars = Array.from(text);
  return chars.length > MAX_TEXT ? chars.slice(-MAX_TEXT).join('') : text;
}

export function sanitizeActivitySubject(input: {
  toolName: string;
  args?: unknown;
  details?: unknown;
  cwd?: string;
}): string | undefined {
  const fields = SUBJECT_FIELDS[input.toolName];
  if (!fields) return undefined;
  for (const field of fields) {
    for (const source of [input.args, input.details]) {
      const value = objectValue(source, field);
      if (typeof value !== 'string' || !value.trim()) continue;
      if (field === 'profileId' && !SAFE_PROFILE_IDS.has(value)) continue;
      const result = safeText(value, input.cwd);
      if (result) return result;
    }
  }
  return undefined;
}

export function safeActivityError(kind: ChildActivityEnvelope['errorKind'] | string = 'unknown'): string {
  if (kind === 'tool_error') return 'tool_error';
  if (kind === 'timeout') return 'timeout';
  if (kind === 'cancelled') return 'cancelled';
  if (kind === 'agent_stopped') return 'agent_stopped';
  return 'unknown';
}

type ActivityState = { context: ActivityTurnContext; toolName: string; args?: unknown; details?: unknown; errorKind?: string; phase: 'started' | 'completed' | 'failed' };

export class ActivityProjector {
  private states = new Map<string, ActivityState>();
  private callIds = new Map<string, string>();
  private counters = new Map<string, number>();

  private validContext(context: ActivityTurnContext): boolean {
    const validSource = context?.source === 'writer' || context?.source === 'character' || context?.source === 'functional';
    const validAgent = context?.source === 'writer'
      ? context.agentId === 'writer'
      : context?.source === 'character'
        ? /^character:[^:]{1,100}$/.test(context.agentId)
        : /^[a-z][a-z0-9-]{1,63}$/.test(context.agentId);
    return !!context && validSource && validAgent
      && typeof context.turnId === 'string' && context.turnId.length > 0 && context.turnId.length <= 180;
  }

  private id(context: ActivityTurnContext, callId: unknown): string | undefined {
    if (!this.validContext(context)) return undefined;
    const raw = typeof callId === 'string' ? callId : '';
    const key = `${context.turnId}:${raw}`;
    if (/^[A-Za-z0-9._-]{1,128}$/.test(raw)) return `${context.turnId}:${raw}`;
    const previous = this.callIds.get(key);
    if (previous) return previous;
    const next = (this.counters.get(context.turnId) ?? 0) + 1;
    this.counters.set(context.turnId, next);
    const generated = `${context.turnId}:tool-${next}`;
    this.callIds.set(key, generated);
    return generated;
  }

  private frame(state: ActivityState, activityId: string): AgentActivityFrame {
    const { context, toolName, args, details, phase } = state;
    const frame: AgentActivityFrame = {
      type: 'agent_activity', source: context.source, agentId: context.agentId,
      turnId: context.turnId, activityId, phase,
      operation: normalizeActivityOperation(toolName), timestamp: new Date().toISOString(),
    };
    const subject = sanitizeActivitySubject({ toolName, args, details });
    if (subject) frame.subject = subject;
    if (KNOWN_TOOL_NAMES.has(toolName)) frame.toolName = toolName;
    if (phase === 'failed') frame.error = safeActivityError(state.errorKind ?? 'unknown');
    return frame;
  }
  acceptToolStart(context: ActivityTurnContext, event: ChildActivityEnvelope): Record<string, unknown>[] {
    const activityId = this.id(context, event.toolCallId);
    if (!activityId || typeof event.toolName !== 'string' || !event.toolName) return [];
    const previous = this.states.get(activityId);
    if (previous) return [];
    const state: ActivityState = {
      context, toolName: event.toolName, args: event.args, details: event.details, phase: 'started',
    };
    this.states.set(activityId, state);
    return [this.frame(state, activityId) as unknown as Record<string, unknown>];
  }

  acceptToolEnd(context: ActivityTurnContext, event: ChildActivityEnvelope): Record<string, unknown>[] {
    const activityId = this.id(context, event.toolCallId);
    if (!activityId || typeof event.toolName !== 'string' || !event.toolName) return [];
    const previous = this.states.get(activityId);
    if (previous && (previous.context.source !== context.source || previous.context.agentId !== context.agentId)) return [];
    if (previous?.phase && previous.phase !== 'started') return [];
    if (previous?.phase === undefined) {
      const state: ActivityState = {
        context, toolName: event.toolName, args: event.args, details: event.details,
        errorKind: event.isError ? (event.errorKind ?? 'tool_error') : undefined,
        phase: event.isError ? 'failed' : 'completed',
      };
      this.states.set(activityId, state);
      return [this.frame(state, activityId) as unknown as Record<string, unknown>];
    }
    const state: ActivityState = {
      context, toolName: event.toolName, args: previous.args ?? event.args,
      details: event.details ?? previous.details,
      errorKind: event.isError ? (event.errorKind ?? 'tool_error') : undefined,
      phase: event.isError ? 'failed' : 'completed',
    };
    this.states.set(activityId, state);
    return [this.frame(state, activityId) as unknown as Record<string, unknown>];
  }

  failAgent(context: ActivityTurnContext, reason: 'timeout' | 'cancelled' | 'agent_stopped'): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const [activityId, previous] of this.states) {
      if (previous.phase !== 'started' || previous.context.source !== context.source || previous.context.agentId !== context.agentId) continue;
      const state = { ...previous, errorKind: reason, phase: 'failed' as const };
      this.states.set(activityId, state);
      out.push(this.frame(state, activityId) as unknown as Record<string, unknown>);
    }
    return out;
  }

  failTurn(context: ActivityTurnContext, reason: 'timeout' | 'cancelled' | 'agent_stopped'): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const [activityId, previous] of this.states) {
      if (previous.phase !== 'started' || previous.context.agentId !== context.agentId || previous.context.turnId !== context.turnId) continue;
      const state = { ...previous, errorKind: reason, phase: 'failed' as const };
      this.states.set(activityId, state);
      out.push(this.frame(state, activityId) as unknown as Record<string, unknown>);
    }
    return out;
  }

  clear(): void {
    this.states.clear();
    this.callIds.clear();
    this.counters.clear();
  }
}
