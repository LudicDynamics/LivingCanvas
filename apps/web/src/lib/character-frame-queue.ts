import { isValidCharacterId } from '@airp/shared/characters';

/** Frames after the App identity router has accepted a legal character id. */
export type CharacterFrame =
  | { type: 'character_delta'; characterId: string; delta: string; timestamp?: string; savePath?: string }
  | { type: 'character_message'; characterId: string; text: string; timestamp?: string; savePath?: string }
  | { type: 'character_idle'; characterId: string; timestamp?: string; savePath?: string }
  | { type: 'error'; source: 'character'; characterId: string; message: string; timestamp?: string; savePath?: string }
  | { type: 'turn_aborted'; source: 'character'; characterId: string; message?: string; timestamp?: string; savePath?: string };

export type CharacterFrameQueueClearReason =
  | 'close'
  | 'stop'
  | 'gap'
  | 'layer-change'
  // Legacy reasons remain accepted by existing App transitions.
  | 'switch'
  | 'world-change'
  | 'disconnect';

export type CharacterFrameQueueBarrier = 'character_message' | 'character_idle';

export type CharacterFrameQueueEvent =
  | {
      kind: 'gap';
      expectedSeq: number;
      receivedSeq: number;
      characterId: string;
      message: string;
    }
  | {
      kind: 'sequence-unavailable';
      characterId: string;
      frameType: CharacterFrame['type'];
      message: string;
    };

type Listener = (event?: CharacterFrameQueueEvent) => void;
interface Entry {
  frame: CharacterFrame;
  deliverySeq: number | null;
}

export interface CharacterFrameQueue {
  /** Null/omitted is the legacy unsequenced lane; it never infers order from timestamps. */
  enqueue(frame: CharacterFrame, deliverySeq?: number | null): void;
  nextDeliverySeq(): number;
  /** Legacy form: drain every frame belonging to characterId. */
  drainUntil(characterId: string): CharacterFrame[];
  /** Barrier form: drain through the first matching terminal/message frame. */
  drainUntil(kind: CharacterFrameQueueBarrier): CharacterFrame[];
  peek(): CharacterFrame | null;
  clear(reason: CharacterFrameQueueClearReason): void;
  subscribe(listener: Listener): () => void;
}

function isFrame(value: unknown): value is CharacterFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Record<string, unknown>;
  if (typeof frame.type !== 'string' || typeof frame.characterId !== 'string') return false;
  if (!isValidCharacterId(frame.characterId)) return false;
  if (frame.type === 'character_delta') return typeof frame.delta === 'string';
  if (frame.type === 'character_message') return typeof frame.text === 'string';
  if (frame.type === 'character_idle') return true;
  if (frame.type === 'error') return frame.source === 'character' && typeof frame.message === 'string';
  if (frame.type === 'turn_aborted') return frame.source === 'character';
  return false;
}

/**
 * The one process-local FIFO for character presentation frames. The queue owns
 * delivery order, not identity: App must reject missing/wrong ids first.
 */
class CharacterFrameQueueImpl implements CharacterFrameQueue {
  private entries: Entry[] = [];
  private sequence = 0;
  private expectedSeq: number | null = null;
  private gapBlocked = false;
  private sequenceUnavailableReported = false;
  private readonly seenSequences = new Set<number>();
  private seenFrames = new WeakSet<object>();
  private readonly listeners = new Set<Listener>();

  enqueue(frame: CharacterFrame, deliverySeq: number | null = null): void {
    if (!isFrame(frame) || this.seenFrames.has(frame)) return;

    let diagnostic: CharacterFrameQueueEvent | undefined;
    if (deliverySeq !== null) {
      if (!Number.isSafeInteger(deliverySeq) || deliverySeq < 1) return;
      this.sequence = Math.max(this.sequence, deliverySeq);
      if (this.seenSequences.has(deliverySeq)) return;
      if (this.gapBlocked) return;
      if (this.expectedSeq !== null && deliverySeq !== this.expectedSeq) {
        const expectedSeq = this.expectedSeq;
        this.entries = [];
        this.gapBlocked = true;
        this.notify({
          kind: 'gap',
          expectedSeq,
          receivedSeq: deliverySeq,
          characterId: frame.characterId,
          message: `Character reply sequence gap: expected ${expectedSeq}, received ${deliverySeq}.`,
        });
        return;
      }
      this.expectedSeq = deliverySeq + 1;
      this.seenSequences.add(deliverySeq);
      this.sequenceUnavailableReported = false;
    } else {
      // A legacy frame has no trustworthy sequence. Timestamp is deliberately
      // ignored: preserving arrival order is safer than inventing a sequence.
      if (!this.sequenceUnavailableReported) {
        this.sequenceUnavailableReported = true;
        diagnostic = {
          kind: 'sequence-unavailable',
          characterId: frame.characterId,
          frameType: frame.type,
          message: 'Character reply sequence unavailable; preserving arrival order.',
        };
      }
    }

    this.seenFrames.add(frame);
    this.entries.push({ frame, deliverySeq });
    // Sequenced entries are strictly monotonic. Unsequenced legacy entries are
    // intentionally not sorted, so timestamp can never reorder or deduplicate.
    this.notify(diagnostic);
  }

  nextDeliverySeq(): number {
    this.sequence += 1;
    return this.sequence;
  }

  drainUntil(characterId: string): CharacterFrame[];
  drainUntil(kind: CharacterFrameQueueBarrier): CharacterFrame[];
  drainUntil(value: string): CharacterFrame[] {
    if (value === 'character_message' || value === 'character_idle') {
      const barrierIndex = this.entries.findIndex((entry) => entry.frame.type === value);
      if (barrierIndex < 0) return [];
      const drained = this.entries.slice(0, barrierIndex + 1).map((entry) => entry.frame);
      this.entries = this.entries.slice(barrierIndex + 1);
      this.notify();
      return drained;
    }
    if (!isValidCharacterId(value)) return [];
    const drained: CharacterFrame[] = [];
    const keep: Entry[] = [];
    for (const entry of this.entries) {
      if (entry.frame.characterId === value) drained.push(entry.frame);
      else keep.push(entry);
    }
    if (drained.length > 0) {
      this.entries = keep;
      this.notify();
    }
    return drained;
  }

  peek(): CharacterFrame | null {
    return this.entries[0]?.frame ?? null;
  }
  clear(_reason: CharacterFrameQueueClearReason): void {
    const changed = this.entries.length > 0 || this.expectedSeq !== null || this.gapBlocked;
    this.entries = [];
    this.expectedSeq = null;
    this.gapBlocked = false;
    // deliverySeq is a process-local ingress clock, so clear never rewinds it
    // or the duplicate registry. A late replay must remain a duplicate.
    this.sequenceUnavailableReported = false;
    if (changed) this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event?: CharacterFrameQueueEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

let owner: CharacterFrameQueue | null = null;

/** Return the singleton owner shared by App and every CharacterModal mount. */
export function getCharacterFrameQueue(): CharacterFrameQueue {
  owner ??= new CharacterFrameQueueImpl();
  return owner;
}

/** Reset only for focused tests; production callers use clear(reason). */
export function resetCharacterFrameQueueForTest(): void {
  owner = new CharacterFrameQueueImpl();
}

/** Strict boundary guard for the App identity router and focused tests. */
export function isCharacterFrame(value: unknown): value is CharacterFrame {
  return isFrame(value);
}
