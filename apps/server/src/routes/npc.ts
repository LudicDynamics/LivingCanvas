/**
 * `POST /api/npc/talk` — say one line to an NPC card.
 *
 * Body `{ path, message }`. The answer is one writer turn, so the request stays
 * open until the NPC has spoken; the reply, any declared give it triggered, and
 * the card's whole recorded exchange come back together. The exchange is also on
 * the card itself, so a reload (or another tab) reads it from the save.
 */
import { Router } from 'express';
import { ActionError, type LocalWorldStore } from '@airp/shared';
import { NpcNoAnswerError, talkToNpc } from '../engine/npc-talk.js';
import { countServerPlayerTurn } from '../engine/player-turn.js';

export interface NpcRouterDeps {
  getStore(): LocalWorldStore | null;
  /** One writer turn for `prompt` in `worldRoot`; resolves with its final text. */
  askWriter(worldRoot: string, prompt: string): Promise<string>;
}

export function createNpcRouter(deps: NpcRouterDeps): Router {
  const router = Router();
  router.post('/npc/talk', async (req, res) => {
    const store = deps.getStore();
    if (!store) { res.status(409).json({ ok: false, code: 'no_active_world', error: 'Load a world first.' }); return; }
    const { path, message } = (req.body ?? {}) as { path?: unknown; message?: unknown };
    try {
      const result = await talkToNpc(
        { store, askWriter: (prompt) => deps.askWriter(store.worldRoot, prompt) },
        { path, message },
      );
      // One line said to an NPC card is one turn of a clock that moves by turns (engine/player-turn.ts);
      // a line that handed something over was already counted by that give's option.
      if (result.gives.length === 0) await countServerPlayerTurn(store, 'talk');
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof ActionError) {
        const http = err.toHttp();
        res.status(http.status).json(http.body);
        return;
      }
      const error = err instanceof Error ? err.message : String(err);
      // A busy or failed writer is a service problem, not a bad request.
      res.status(err instanceof NpcNoAnswerError ? 502 : 503).json({ ok: false, code: 'writer_unavailable', error });
    }
  });
  return router;
}
