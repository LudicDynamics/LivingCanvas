import type { CharacterPresenceView } from './presence.js';

export interface RailEntry {
  canTalk: boolean;
  canTravel: boolean;
  statusKey: string;
  followActionKey: string;
  talkHintKey: string | null;
  tone: 'full' | 'muted';
  followedByPlayer: boolean;
}

export function railEntry(view: Pick<CharacterPresenceView, 'state' | 'following'>): RailEntry;
