/**
 * Duplex character channel.
 *
 * A live voice front-end (today GPT Live; later our own fine-tuned duplex
 * character model) hands the user's request to the backend character agent
 * and needs TWO things back, not one: the character's spoken reply, and a
 * receipt of what the agent actually DID in the world — otherwise the call is
 * a one-way pipe and "did you do it?" has no answer. This module is the
 * backend-independent half of that contract:
 *
 * - `DuplexCharacterChannel` is what the registry talks to. GPT Live's
 *   sideband implements it (`createLiveSidebandChannel`); a future model only
 *   needs another implementation, nothing in the delegation flow changes.
 * - `receiptOf` projects a finished agent turn's tool events into an action
 *   receipt; `receiptLine` phrases it for the voice to paraphrase aloud.
 *
 * Nothing here knows about WebRTC, OpenAI event names or the character's
 * personality — that stays in live-session.ts and the character agent.
 */
import type { JsonAgentSessionEvent } from '../../../../vendor/pi-rp/packages/coding-agent/dist/index.js';
import type { LiveLanguage } from '@airp/shared';

/** One world-changing tool call the character agent completed during a delegation. */
export interface ActionReceipt {
  tool: string;
  ok: boolean;
  /** The file the tool touched, when it reported one (`args.path` / `details.path`). */
  path?: string;
  /** A second path for two-ended tools (`use_item_on` target, `move` destination). */
  target?: string;
}

/** What a finished delegation hands the channel. */
export interface DelegationResult {
  /** The character's reply text, already sanitised by the caller or empty. */
  text: string;
  receipt: ActionReceipt[];
}

/**
 * The backend-independent voice link for ONE character call. Frames, event
 * ids and transport belong to the implementation; the registry only knows
 * "say this" and "note this".
 */
export interface DuplexCharacterChannel {
  /** Implementation tag, for logs and the connection self-test. */
  readonly kind: 'gpt-live' | 'voice-live' | (string & {});
  /** Speak the character's own words (the voice paraphrases, never reads a script). */
  speak(delegationId: string, content: string): void;
  /** A visible note the voice should act on but that is not the character's line. */
  notice(delegationId: string | null, content: string): void;
  close(): void;
}

/** Tools whose completion is worth telling the user about; read-only tools are not. */
const WORLD_TOOLS = new Set([
  'chalk', 'write', 'move', 'move_to', 'use_item_on', 'link', 'arrange', 'roll_dice', 'skill_check',
  'choose', 'delete', 'set_following', 'generate_image', 'show', 'create_char',
]);

function pathOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Pure: the world-changing tool calls of one turn, in order, with the paths
 * they reported. `tool_execution_start` carries the args (the intended path);
 * `tool_execution_end` carries the verdict (`isError`) and the landed path.
 */
export function receiptOf(events: readonly JsonAgentSessionEvent[]): ActionReceipt[] {
  const argsByCall = new Map<string, Record<string, unknown>>();
  const out: ActionReceipt[] = [];
  for (const event of events) {
    if (event.type === 'tool_execution_start') {
      const args = event.args && typeof event.args === 'object' ? event.args as Record<string, unknown> : {};
      argsByCall.set(event.toolCallId, args);
    } else if (event.type === 'tool_execution_end') {
      const args = argsByCall.get(event.toolCallId) ?? {};
      argsByCall.delete(event.toolCallId);
      if (!WORLD_TOOLS.has(event.toolName)) continue;
      const result = (event.result ?? null) as Record<string, unknown> | null;
      const details = (result?.details ?? {}) as Record<string, unknown>;
      const path = pathOf(details.path) ?? pathOf(args.path) ?? pathOf(args.item) ?? pathOf(args.from);
      const target = pathOf(args.target) ?? pathOf(args.to) ?? pathOf(args.layer) ?? pathOf(details.layer);
      out.push({ tool: event.toolName, ok: !event.isError, ...(path ? { path } : {}), ...(target && target !== path ? { target } : {}) });
    }
  }
  return out;
}

/** `world/inn/old-key.md` → "old key"; a directory keeps its last segment. */
function nameOf(path: string): string {
  const leaf = path.replace(/\/README\.md$/, '').split('/').pop() ?? path;
  return leaf.replace(/\.md$/, '').replace(/[-_]+/g, ' ');
}

const PHRASES: Record<LiveLanguage, Record<string, (r: ActionReceipt) => string>> = {
  en: {
    chalk: () => 'wrote it into the story',
    write: (r) => r.path ? `wrote ${nameOf(r.path)}` : 'wrote a note',
    move: (r) => r.path && r.target ? `moved ${nameOf(r.path)} to ${nameOf(r.target)}` : 'moved something',
    move_to: (r) => r.target ? `went to ${nameOf(r.target)}` : 'moved',
    use_item_on: (r) => r.path && r.target ? `used ${nameOf(r.path)} on ${nameOf(r.target)}` : 'used an item',
    link: () => 'connected the clues',
    arrange: () => 'tidied the table',
    roll_dice: () => 'rolled the dice',
    skill_check: () => 'tried my hand at it',
    choose: () => 'made the choice',
    delete: (r) => r.path ? `removed ${nameOf(r.path)}` : 'removed something',
    set_following: () => 'changed who follows you',
    generate_image: () => 'drew a picture',
    show: (r) => r.path ? `showed ${nameOf(r.path)}` : 'showed something',
    create_char: () => 'introduced someone new',
  },
  ja: {
    chalk: () => '物語に書き留めました',
    write: (r) => r.path ? `${nameOf(r.path)}を書きました` : 'メモを書きました',
    move: (r) => r.path && r.target ? `${nameOf(r.path)}を${nameOf(r.target)}へ移しました` : '何かを移しました',
    move_to: (r) => r.target ? `${nameOf(r.target)}へ向かいました` : '移動しました',
    use_item_on: (r) => r.path && r.target ? `${nameOf(r.path)}を${nameOf(r.target)}に使いました` : '道具を使いました',
    link: () => '手がかりを結びました',
    arrange: () => '机の上を整えました',
    roll_dice: () => 'ダイスを振りました',
    skill_check: () => '技能で判定しました',
    choose: () => '選びました',
    delete: (r) => r.path ? `${nameOf(r.path)}を片付けました` : '何かを片付けました',
    set_following: () => '同行を変えました',
    generate_image: () => '絵を描きました',
    show: (r) => r.path ? `${nameOf(r.path)}を見せました` : '何かを見せました',
    create_char: () => '新しい人を紹介しました',
  },
  ko: {
    chalk: () => '이야기에 적어 두었어요',
    write: (r) => r.path ? `${nameOf(r.path)}을(를) 썼어요` : '메모를 썼어요',
    move: (r) => r.path && r.target ? `${nameOf(r.path)}을(를) ${nameOf(r.target)}(으)로 옮겼어요` : '무언가를 옮겼어요',
    move_to: (r) => r.target ? `${nameOf(r.target)}(으)로 갔어요` : '이동했어요',
    use_item_on: (r) => r.path && r.target ? `${nameOf(r.path)}을(를) ${nameOf(r.target)}에 썼어요` : '물건을 썼어요',
    link: () => '단서를 이었어요',
    arrange: () => '책상 위를 정리했어요',
    roll_dice: () => '주사위를 굴렸어요',
    skill_check: () => '기능 판정을 했어요',
    choose: () => '선택했어요',
    delete: (r) => r.path ? `${nameOf(r.path)}을(를) 치웠어요` : '무언가를 치웠어요',
    set_following: () => '동행을 바꿨어요',
    generate_image: () => '그림을 그렸어요',
    show: (r) => r.path ? `${nameOf(r.path)}을(를) 보여 줬어요` : '무언가를 보여 줬어요',
    create_char: () => '새로운 사람을 소개했어요',
  },
};

/**
 * Pure: one spoken-sized line the voice paraphrases as "done". Failed calls
 * are named so the user hears that it did NOT happen; empty receipts → null.
 */
export function receiptLine(receipt: readonly ActionReceipt[], language: LiveLanguage): string | null {
  if (receipt.length === 0) return null;
  const table = PHRASES[language] ?? PHRASES.en;
  const done = receipt.filter((r) => r.ok).map((r) => (table[r.tool] ?? (() => r.tool.replace(/_/g, ' ')))(r));
  const failed = receipt.filter((r) => !r.ok).map((r) => (table[r.tool] ?? (() => r.tool.replace(/_/g, ' ')))(r));
  const parts: string[] = [];
  if (language === 'ja') {
    if (done.length) parts.push(`（完了：${[...new Set(done)].join('、')}）`);
    if (failed.length) parts.push(`（できなかったこと：${[...new Set(failed)].join('、')}）`);
  } else if (language === 'ko') {
    if (done.length) parts.push(`(완료: ${[...new Set(done)].join(', ')})`);
    if (failed.length) parts.push(`(하지 못한 일: ${[...new Set(failed)].join(', ')})`);
  } else {
    if (done.length) parts.push(`(Done: ${[...new Set(done)].join('; ')}.)`);
    if (failed.length) parts.push(`(Could not: ${[...new Set(failed)].join('; ')}.)`);
  }
  return parts.join(' ');
}

/**
 * The second implementation — the one the design notes
 * §1 promised would need no change to the delegation flow, and it did not.
 *
 * voice-live's shape differs from GPT Live's in a way worth being precise
 * about. GPT Live PULLS: its model decides to delegate, our sideband receives
 * `delegation.created`, and the character's words have to be pushed back up the
 * same socket for the voice to paraphrase. voice-live with `VOICE_LIVE_BRAIN=airp`
 * PULLS TOO, but over a socket it opens to our ordinary canvas WebSocket as a
 * client — it sends `character_start` / `character_prompt` and reads the
 * `character_*` frames, exactly as the dock does. So there is no sideband here
 * to push words into: the words leave through the frames we already broadcast.
 *
 * What this channel is for, then, is `deliver()`'s other caller — anything that
 * wants a character turn's words and receipt as a VALUE rather than as frames.
 * It collects instead of transmitting. `close()` is a no-op because it owns no
 * socket; `notice` is kept separate from `speak` so a caller can still tell a
 * visible degradation apart from the character's own line.
 */
export function createCollectingChannel(kind = 'voice-live'): DuplexCharacterChannel & {
  readonly spoken: string[];
  readonly notices: string[];
} {
  const spoken: string[] = [];
  const notices: string[] = [];
  return {
    kind,
    spoken,
    notices,
    speak: (_delegationId, content) => { spoken.push(content); },
    notice: (_delegationId, content) => { notices.push(content); },
    close: () => { /* nothing is held open */ },
  };
}

/** The narrow socket the GPT Live sideband channel writes to. */
export interface DuplexSocket {
  send(data: string): void;
  close(): void;
}

/**
 * GPT Live's implementation: `session.commentary.append` for the character's
 * words, `session.instructions.append` for notices.
 * `salt()` keeps every event_id unique; `onFailure` is the visible-failure
 * slot — an append that throws is never swallowed.
 */
export function createLiveSidebandChannel(input: {
  socket: DuplexSocket;
  salt: () => number;
  onFailure: (reason: string) => void;
}): DuplexCharacterChannel {
  const send = (frame: Record<string, unknown>, what: string) => {
    try {
      input.socket.send(JSON.stringify(frame));
    } catch (err) {
      input.onFailure(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return {
    kind: 'gpt-live',
    speak: (delegationId, content) => send({
      type: 'session.commentary.append',
      event_id: `commentary_${delegationId}_${input.salt()}`,
      delegation_id: delegationId,
      content,
    }, 'commentary append'),
    notice: (delegationId, content) => send({
      type: 'session.instructions.append',
      event_id: `instructions_${input.salt()}`,
      delegation_id: delegationId,
      content,
    }, 'instructions append'),
    close: () => { try { input.socket.close(); } catch { /* already closed */ } },
  };
}
