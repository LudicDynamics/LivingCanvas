/**
 * The frames that end a character chat.
 *
 * The server writes the writer's summary of the chat on `character_stop`
 * (dialogue closed / switched) and on `character_talk_end` (the chat ended but
 * the agent stays: a voice call hung up, the nook closed). `beat: false` asks
 * it not to follow with a quiet writer turn — always while the forced tutorial
 * runs, which App reports through `holdChatBeats`.
 */
let held = false;

/** App: the forced tutorial is (not) running. */
export function holdChatBeats(on: boolean): void {
  held = on;
}

export function chatBeatsHeld(): boolean {
  return held;
}

export type ChatEndVia = 'dialogue' | 'voice';

export function characterStopFrame(characterId: string): Record<string, unknown> {
  return { type: 'character_stop', characterId, ...(held ? { beat: false } : {}) };
}

export function chatEndFrame(characterId: string, via: ChatEndVia): Record<string, unknown> {
  return { type: 'character_talk_end', characterId, via, ...(held ? { beat: false } : {}) };
}
