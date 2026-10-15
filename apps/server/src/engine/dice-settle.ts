/**
 * The writer's turn ends → the engine pays the dice it left unpaid
 *. A 跑团 world's 大失败 still owing a
 * cost, or 大成功 still owing a bonus, gets the world's default
 * (`dice.consequences`, by category) and the card records `by: default`.
 *
 * A PLAYER roll that resolved while the writer was already mid-turn is left for
 * the next turn: the writer never saw it. The settle is serialized per world and
 * never throws — a failed settle is logged and retried on the next turn end.
 */
import { createActionService } from '@airp/shared';
import type { LocalWorldStore } from '@airp/shared';

export class DiceSettler {
  private turnStartSeq = new Map<string, number>();
  private chain = new Map<string, Promise<unknown>>();

  constructor(private readonly storeFor: (worldRoot: string) => LocalWorldStore | null, private readonly log: (line: string) => void = (l) => console.info(l)) {}

  /** Feed every writer engine event; only `agent_start` / `agent_settled` matter. */
  onWriterEvent(type: string, worldRoot: string): Promise<void> | void {
    const store = this.storeFor(worldRoot);
    if (!store) return;
    if (type === 'agent_start') {
      return void store.getMaxSeq().then((seq) => { this.turnStartSeq.set(worldRoot, seq + 1); }, () => {});
    }
    if (type !== 'agent_settled') return;
    const before = this.turnStartSeq.get(worldRoot);
    this.turnStartSeq.delete(worldRoot);
    const run = (this.chain.get(worldRoot) ?? Promise.resolve()).then(() => this.settle(store, before));
    this.chain.set(worldRoot, run.catch(() => {}));
    return run;
  }

  async settle(store: LocalWorldStore, rollsBeforeSeq?: number): Promise<void> {
    try {
      const svc = createActionService(store, { type: 'engine' }, { turn: `dice-settle:${Date.now()}` });
      const result = await svc.settleDiceConsequences(rollsBeforeSeq === undefined ? {} : { rollsBeforeSeq });
      const settled = (result.details as { settled?: unknown[] }).settled ?? [];
      if (settled.length) this.log(`[AIRP Dice] writer left ${settled.length} tier consequence(s) unpaid; engine default applied:\n${result.text}`);
    } catch (err) {
      this.log(`[AIRP Dice] settle failed: ${(err as Error).message}`);
    }
  }
}
