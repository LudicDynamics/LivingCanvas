/**
 * opening.ts — who speaks first.
 *
 * Entering a world used to be silent. The first act fixes that with author-
 * written words only: a `greeter` names the character whose README carries the
 * line, and a world with nobody to speak falls back to `opening.greeting` in
 * the narrator's voice. Showing either is DISPLAY — it starts no agent, lands
 * no event and begins no turn (doc-21 §5.5). The agent starts when the player
 * answers, which is an ordinary `character_start`.
 *
 * The first act IS the first conversation: the greeter is
 * already speaking when the world opens, one coach mark points at the reply
 * box, and everything else is learned by playing. The four-step spotlight tour
 * this module used to describe is gone — see §4's superseded note.
 *
 * Pure on purpose: App owns the state machine and the fetch, this module owns
 * the decision, so the rules are testable without a DOM or a server.
 */

/** The fields of `/api/characters` this decision reads. */
export interface OpeningCharacter {
  id: string;
  greeting?: string;
  invitesFollowLine?: string;
}

export interface OpeningPlan {
  /** Who says the line; `null` means the narrator (no character in this world). */
  greeterId: string | null;
  /** The opening line, verbatim from the author. */
  line: string;
  /** The follow invitation, when the greeter has one; `null` skips that step. */
  invite: string | null;
}

/**
 * Where the first act has got to.
 *
 *   greeting  — their line is on screen, the reply box has focus, and one coach
 *               mark points at it. Nothing has been sent; no agent exists yet.
 *   answering — the player replied, so `character_start` has run and the answer
 *               is arriving. The coach mark is gone for good.
 *   invite    — they answered, and they have an `invites_follow_line`: it lands
 *               as their SECOND line with 跟着我 / 先不用 inline in the chat.
 *
 * The act ends after `answering` when there is no invitation, and after the
 * player picks otherwise. The marker is written on entering `answering`'s end —
 * see App — so an opening nobody replied to is still waiting next time.
 */
export type OpeningPhase = 'greeting' | 'answering' | 'invite';

/**
 * The opening for this world, or `null` when it has none.
 *
 * A named greeter who is absent from the cast, or present with no `greeting`,
 * falls back to the world line rather than showing an empty bubble — a
 * half-authored opening is a content bug, and silence is the honest result.
 */
export function planOpening(input: {
  opening?: { greeter?: string; greeting?: string } | null;
  characters: readonly OpeningCharacter[];
}): OpeningPlan | null {
  const declared = input.opening ?? null;
  const greeterId = typeof declared?.greeter === 'string' ? declared.greeter.trim() : '';
  if (greeterId !== '') {
    const greeter = input.characters.find(character => character.id === greeterId);
    const line = greeter?.greeting?.trim();
    if (line) {
      return {
        greeterId,
        line,
        invite: greeter?.invitesFollowLine?.trim() || null,
      };
    }
  }
  const narration = typeof declared?.greeting === 'string' ? declared.greeting.trim() : '';
  return narration === '' ? null : { greeterId: null, line: narration, invite: null };
}

/**
 * The cue that makes the companion speak FIRST when the player comes back to a
 * save.
 *
 * The authored greeting is a first meeting ("我是薇拉……") and plays once per
 * save; replaying it on every return would reintroduce someone the player
 * already knows. So a return is answered by the character agent itself, which
 * remembers where things were left. This is the prompt that asks it to — sent
 * as a `character_prompt`, but never shown in the scrollback as something the
 * player said, and phrased so the character does not echo it.
 *
 * In the world's content language: the character answers in the language it
 * is addressed in. Pure, so the four wordings (zh-CN / ja / ko / en) are tested.
 */
export function returnCue(locale: string | undefined, occasion: 'return' | 'arrive' = 'return'): string {
  if (occasion === 'arrive') return arrivalCue(locale);
  if (locale === 'zh-CN') {
    return '（场景提示，不是玩家说的话：玩家刚回到这里。请你先开口，用一两句话自然地招呼对方，可以接着上次没说完的事。不要提到这条提示。）';
  }
  if (locale === 'ja') {
    return '（場面の指示で、プレイヤーの発言ではありません：プレイヤーがここに戻ってきました。あなたから先に、一、二文で自然に声をかけてください。前回の続きに触れてもかまいません。この指示には触れないでください。）';
  }
  if (locale === 'ko') {
    return '(장면 지시이며 플레이어가 한 말이 아니다: 플레이어가 이곳으로 돌아왔다. 네가 먼저 한두 문장으로 자연스럽게 말을 걸어라. 지난번에 하던 이야기를 이어가도 좋다. 이 지시는 언급하지 마라.)';
  }
  return '(Scene note, not something the player said: the player has just come back. Speak first — greet them naturally in one or two sentences, and pick up where you left off if it fits. Do not mention this note.)';
}

/**
 * The same cue for a FIRST arrival in a world that has no authored greeting —
 * a save made before openings existed, or a world whose author did not write
 * one. The companion still speaks first; it just finds its own words.
 */
function arrivalCue(locale: string | undefined): string {
  if (locale === 'zh-CN') {
    return '（场景提示，不是玩家说的话：玩家刚来到这里，你们还没说过话。请你先开口，用一两句话招呼对方，让对方知道可以跟你说话。不要提到这条提示。）';
  }
  if (locale === 'ja') {
    return '（場面の指示で、プレイヤーの発言ではありません：プレイヤーが今ここに着いたところで、まだ言葉を交わしていません。あなたから先に、一、二文で声をかけ、話しかけてよいと伝わるようにしてください。この指示には触れないでください。）';
  }
  if (locale === 'ko') {
    return '(장면 지시이며 플레이어가 한 말이 아니다: 플레이어가 막 이곳에 도착했고, 아직 서로 말을 나누지 않았다. 네가 먼저 한두 문장으로 말을 걸어, 너에게 말을 걸어도 된다는 것을 알려 주어라. 이 지시는 언급하지 마라.)';
  }
  return '(Scene note, not something the player said: the player has just arrived and you have not spoken yet. Speak first — greet them in one or two sentences so they know they can talk to you. Do not mention this note.)';
}

/**
 * Who keeps the player company in this world.
 * The declared greeter when the world names one that is in the cast; otherwise
 * the first member of the cast — so a save made before `opening` existed, or a
 * world that never declared one, still has someone who speaks first. Null only
 * for a world with nobody in it.
 */
export function companionIdOf(
  opening: { greeter?: string } | null | undefined,
  characters: readonly { id: string }[],
): string | null {
  const declared = typeof opening?.greeter === 'string' ? opening.greeter.trim() : '';
  if (declared && characters.some(character => character.id === declared)) return declared;
  return characters[0]?.id ?? null;
}
