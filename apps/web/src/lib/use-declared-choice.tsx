import React from 'react';
import { useLocale } from './i18n.js';
import { AirpRequestError } from './airp-gateway.js';
import { holdReveal } from './dice-ceremony.js';
import {
  useActionFeedback,
  actionDetailsOf,
  type ActionFeedback,
  type ActionIntent,
  type ActionResultLike,
  type ActionVerb,
  type ReconcileReceipt,
} from './action-feedback.js';
import {
  DeclaredActionDialog,
  type DeclaredResponse,
  type MaterialSelection,
} from '../components/narrative/DeclaredActionDialog.js';
import type { FocusCoordinator } from './focus-coordinator.js';
import { requestNpcTalk } from './npc-dialogue.js';

/**
 * use-declared-choice — the ONE path a picked option travels (the design notes,
 * the design notes).
 *
 * P2 moves the options off the cards and into the left rail, which means two
 * different components now answer the same click. The semantics may not fork:
 * a choice is a domain action, so every click goes through the action
 * coordinator to `/api/choice`, and the authoritative `action` that comes back
 * decides what happens next (enter a layer, open the reading dialog, take an
 * item, open a character, or — only for `kind: writer` — draft a prompt).
 * That logic lives here once; `EntityInteractions` and `ChoiceRail` are both
 * callers, and neither of them may call the gateway itself.
 *
 * The hook is deliberately NOT per-item: the rail renders the options of every
 * card on the layer, and hooks cannot be called in a loop. Callers pass
 * `resolveItem(path)` instead, which is how a choice still finds its own
 * frontmatter (for the option label) and body (for a pending dice roll).
 */

/** What the hook needs to know about the card a choice belongs to. */
export interface DeclaredChoiceItem {
  path: string;
  frontmatter?: Record<string, any> | null;
  body?: string;
}

export interface UseDeclaredChoiceInput {
  /** The card a path names, for the option label and the dice-reveal hold. */
  resolveItem: (path: string) => DeclaredChoiceItem | null | undefined;
  /** Action-feedback projection (`layer:<id>` / `nook:<id>`). */
  projection: string;
  onChoice?: (prompt: string) => void;
  onEnterGate?: (path: string) => void;
  onOpenCharacter?: (characterId: string) => void;
  onActionResult?: (result: ActionFeedback) => void;
}

export interface DeclaredChoiceApi {
  /** Run one option. Same semantics from the card panel and from the rail. */
  choose: (path: string, choice: string) => void;
  /**
   * The raw coordinator call, for the sibling actions that are not choices
   * (`take along`, material review). Exposed so no caller reimplements it.
   */
  runAction: <TDetails>(
    verb: ActionVerb,
    target: string,
    request?: (signal: AbortSignal) => Promise<ActionResultLike<TDetails>>,
    acceptedMessage?: string,
    operands?: Pick<ActionIntent, 'item' | 'from' | 'to' | 'choice'>,
  ) => Promise<ActionFeedback<TDetails> | null>;
  busy: boolean;
  feedback: string;
  feedbackStatus: string | null;
  error: string;
  setError: (message: string) => void;
  /** The authoritative snapshot a `read` / `stage` answer opened, or null. */
  direct: DeclaredResponse | null;
  closeDirect: () => void;
  submitMaterialReview: (selections: MaterialSelection[]) => Promise<string>;
  sendReview: (prompt: string) => void;
}

type DeclaredChoiceDetails = { action: DeclaredResponse };
type MaterialReviewDetails = {
  prompt: string;
  materials: Array<{ slot: string; path: string; revision: string }>;
};

/** The feedback projection a path belongs to; the rail passes its layer instead. */
export function projectionForPath(path: string): string {
  if (path.startsWith('characters/')) return `nook:${path.split('/')[1] ?? 'unknown'}`;
  return `layer:${path.startsWith('world/') ? 'map' : path.split('/')[0] ?? 'map'}`;
}

/** The option's human label for a declared choice id; falls back to the id itself. */
export function choiceLabelOf(fm: Record<string, any> | null | undefined, choice: string | number): string {
  const options = fm?.choice?.options;
  if (Array.isArray(options)) {
    const option = options.find((candidate: unknown) => candidate && typeof candidate === 'object' && (candidate as { id?: unknown }).id === choice);
    const label = option && typeof option === 'object' ? (option as { label?: unknown }).label : undefined;
    if (typeof label === 'string' && label.trim()) return label;
  }
  return String(choice);
}

export function declaredActionOf(value: unknown): DeclaredResponse | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as Record<string, unknown>;
  if (!['read', 'take', 'stage', 'enter', 'character', 'reply', 'writer', 'search', 'talk'].includes(String(action.kind))
    || typeof action.source !== 'string'
    || (typeof action.choice !== 'string' && typeof action.choice !== 'number')
    || typeof action.revision !== 'string'
    || !Array.isArray(action.items)
    || !Array.isArray(action.missing)) return null;
  if (action.kind === 'stage' && !Array.isArray(action.slots)) return null;
  return action as DeclaredResponse;
}

export function useDeclaredChoice({
  resolveItem,
  projection,
  onChoice,
  onEnterGate,
  onOpenCharacter,
  onActionResult,
}: UseDeclaredChoiceInput): DeclaredChoiceApi {
  const { t } = useLocale();
  const coordinator = useActionFeedback();
  const [busy, setBusy] = React.useState(false);
  const [feedbackStatus, setFeedbackStatus] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState('');
  const [error, setError] = React.useState('');
  const [direct, setDirect] = React.useState<DeclaredResponse | null>(null);
  const running = React.useRef(false);

  const publish = (result: ActionFeedback, acceptedMessage?: string) => {
    onActionResult?.(result);
    setFeedbackStatus(result.outcome);
    if (result.outcome === 'accepted') {
      setFeedback(acceptedMessage ?? result.message);
      setError('');
    } else if (result.outcome === 'conflict') {
      setFeedback(result.message);
      setError('');
    } else if (result.outcome === 'rejected' || result.outcome === 'failed') {
      setFeedback('');
      setError(result.message);
    }
  };

  const runAction = async <TDetails,>(
    verb: ActionVerb,
    target: string,
    request?: (signal: AbortSignal) => Promise<ActionResultLike<TDetails>>,
    acceptedMessage?: string,
    operands: Pick<ActionIntent, 'item' | 'from' | 'to' | 'choice'> = {},
  ): Promise<ActionFeedback<TDetails> | null> => {
    if (running.current) return null;
    if (!coordinator || !coordinator.worldId) {
      setError('The action is unavailable until a world is loaded.');
      return null;
    }
    running.current = true;
    setBusy(true); setError(''); setFeedback('');
    const intent: ActionIntent = {
      worldId: coordinator.worldId,
      projection,
      verb,
      source: 'button',
      target,
      ...operands,
    };
    try {
      const reconcile = async (_details: TDetails, signal: AbortSignal): Promise<ReconcileReceipt> => {
        if (signal.aborted) throw new DOMException('Action reconciliation was cancelled.', 'AbortError');
        return { status: 'not-required', source: 'details.event', projection };
      };
      const result = request
        ? await coordinator.execute(intent, request, reconcile)
        : await coordinator.executeIntent<TDetails>(intent, reconcile);
      publish(result, acceptedMessage);
      return result;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const handleDeclaredAction = (action: DeclaredResponse) => {
    const fm = resolveItem(action.source)?.frontmatter;
    if (action.kind === 'enter' && typeof action.target === 'string') {
      setDirect(null);
      onEnterGate?.(action.target);
    } else if (action.kind === 'character' && typeof action.character === 'string') {
      setDirect(null);
      onOpenCharacter?.(action.character);
    } else if (action.kind === 'talk' && typeof action.npc === 'string') {
      // A writer slip that hands the player to an NPC: their own conversation opens.
      setDirect(null);
      requestNpcTalk({ path: action.npc, frontmatter: (action.frontmatter as Record<string, unknown> | null | undefined) ?? null });
    } else if (action.kind === 'writer') {
      // A `writer` declaration is a request for the writer, never a document:
      // the server only records `choice_selected` for it (declared-actions.ts)
      // and does not dispatch, so the client hands the prompt over here. A
      // declaration without `prompt` (first-snow's "Reply to Nanami…") sends
      // the option's own label — an empty dialog with a lone Return was the
      // bug.
      setDirect(null);
      const label = choiceLabelOf(fm, action.choice);
      const prompt = typeof action.prompt === 'string' && action.prompt.trim()
        ? action.prompt
        : `Regarding world file ${JSON.stringify(action.source)}, the player selected the choice: ${label}`;
      if (!onChoice) {
        setError('The writer input is unavailable. Return to the scene.');
        return;
      }
      onChoice(prompt);
    } else if (action.kind === 'take') {
      // The server already moved the items into player/ (declared-actions.ts);
      // a `take` is done the moment it is clicked, so it gets a one-line
      // receipt here, not a document to close. Only `read`
      // opens the focused popup.
      setDirect(null);
      const titles = action.items.map(entry => entry.title).filter(Boolean);
      setFeedback(titles.length > 0 ? `${t('Taken')}: ${titles.join(', ')}` : t('Taken'));
      setError('');
    } else {
      setDirect(action);
    }
  };

  const executeDeclaredChoice = async (source: string, choice: string) => {
    const item = resolveItem(source);
    // A declared roll is written into the card before its ceremony plays; hold
    // the reveal from the moment the option is pressed.
    const rolling = Boolean(item?.frontmatter?.dice_outcomes)
      && !/<!--\s*resolved-dice:/.test(item?.body ?? '');
    if (rolling) holdReveal(source);
    const result = await runAction<DeclaredChoiceDetails>('choice', source, undefined, undefined, { choice });
    if (result?.outcome !== 'accepted' || !result.details) return;
    const action = declaredActionOf(result.details.action);
    if (!action) return;
    handleDeclaredAction(action);
  };

  const choose = (path: string, choice: string) => {
    // Choices are domain actions, not writer prompts: every
    // click runs through `/api/choice`. A plain choice lands `choice_selected`
    // (the world's `autoWrite` decides whether a writer turn follows); a
    // declared `choice_actions` entry (enter / read / take / character / stage)
    // comes back as an authoritative `action` that opens the dialog or moves
    // the player. Registered as the direct-API exception of the design notes
    // Only a `kind: writer` declaration fills the draft (handleDeclaredAction).
    void executeDeclaredChoice(path, choice);
  };

  const requestMaterialReview = async (action: DeclaredResponse, selections: MaterialSelection[], signal?: AbortSignal) => {
    const response = await fetch('/api/material-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ world: action.world, path: action.source, choice: action.choice, revision: action.revision, selections }),
      signal,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AirpRequestError(`POST /api/material-review -> ${response.status}`, response.status, null);
    }
    if (!payload || typeof payload !== 'object') {
      throw new AirpRequestError(`POST /api/material-review -> ${response.status}`, response.status, null);
    }
    const result = payload as ActionResultLike<MaterialReviewDetails>;
    if (!response.ok) throw new AirpRequestError(`POST /api/material-review -> ${response.status}`, response.status, payload as Record<string, unknown>);
    if ('ok' in result && result.ok === true) {
      const details = actionDetailsOf<MaterialReviewDetails>(result);
      if (!details || typeof details.prompt !== 'string' || !Array.isArray(details.materials)) {
        throw new Error('The material review response is invalid. Reopen the panel.');
      }
    }
    return result;
  };

  const submitMaterialReview = async (selections: MaterialSelection[]): Promise<string> => {
    if (!direct) throw new Error('The action snapshot is no longer available. Reopen the panel.');
    const result = await runAction<MaterialReviewDetails>(
      'act',
      direct.source,
      signal => requestMaterialReview(direct, selections, signal),
    );
    if (result?.outcome !== 'accepted' || !result.details) throw new Error(result?.message ?? 'The review draft was not accepted.');
    return result.details.prompt;
  };

  const sendReview = (prompt: string) => {
    if (!onChoice) {
      setError('The writer input is unavailable. Return to the scene.');
      return;
    }
    onChoice(prompt);
    setDirect(null);
  };

  return {
    choose,
    runAction,
    busy,
    feedback,
    feedbackStatus,
    error,
    setError,
    direct,
    closeDirect: () => setDirect(null),
    submitMaterialReview,
    sendReview,
  };
}

/**
 * The declared-action dialog, wired to a `useDeclaredChoice` result. Both
 * callers render this one element rather than repeating the wiring, so a
 * `read` opened from the rail and from a card behave identically.
 */
export function DeclaredChoiceHost({
  declared,
  focus,
}: {
  declared: DeclaredChoiceApi;
  focus?: FocusCoordinator;
}): React.ReactElement | null {
  const { direct } = declared;
  if (!direct) return null;
  return (
    <DeclaredActionDialog
      key={`${direct.source}:${String(direct.choice)}:${direct.revision}`}
      value={direct}
      onClose={declared.closeDirect}
      onChoose={declared.choose}
      onSubmit={declared.submitMaterialReview}
      focus={focus}
      onSendReview={declared.sendReview}
    />
  );
}
