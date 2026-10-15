import { z } from 'zod';
import type { ShowDef } from './types.js';

/**
 * The seven performances (doc 10 §14.3). These are NOT docked components: they
 * write nothing, append no event, and leave no canvas state. `show` returns a
 * `show_frame` in `details`, and the server relays it.
 *
 * Each entry carries its own param schema so `show` can validate `params`
 * before broadcasting — an invalid param is `isError`, never a silently empty
 * performance.
 */


export const SHOWS: ShowDef[] = [
  {
    id: 'spotlight',
    purpose: 'A stage light: the canvas dims and a warm beam falls on the target.',
    params: z
      .object({
        dim: z.number().min(0).max(1).optional(),
        spread: z.number().optional(),
        tone: z.string().optional(),
      })
      .passthrough(),
    defaultDuration: 2400,
    requiresTarget: true,
  },
  {
    id: 'lights_out',
    purpose: 'The lights go out: the scene darkens to night.',
    params: z
      .object({
        dim: z.number().min(0).max(1).optional(),
        focus: z.string().optional(),
      })
      .passthrough(),
    defaultDuration: 1800,
    requiresTarget: false,
  },
  {
    id: 'fireworks',
    purpose: 'Fireworks: particles burst above the canvas.',
    params: z
      .object({
        color: z.string().optional(),
        bursts: z.number().int().positive().optional(),
        origin: z.string().optional(),
      })
      .passthrough(),
    defaultDuration: 3000,
    requiresTarget: false,
  },
  {
    id: 'evidence_burst',
    purpose: 'A storm of clues: threads run from each linked card to the target.',
    params: z
      .object({
        links: z.array(z.string()).optional(),
        staggerMs: z.number().optional(),
        color: z.string().optional(),
      })
      .passthrough(),
    defaultDuration: 3600,
    requiresTarget: true,
  },
  {
    id: 'camera_focus',
    purpose: 'The camera flies to the target without dimming the canvas.',
    params: z.object({ zoom: z.number().optional() }).passthrough(),
    defaultDuration: 1600,
    requiresTarget: true,
  },
  {
    id: 'ink_burst',
    purpose: 'One splash of ink spreads across the target card.',
    params: z
      .object({
        tone: z.enum(['ink', 'rust', 'blue', 'sage']).optional(),
        scale: z.number().optional(),
      })
      .passthrough(),
    defaultDuration: 1200,
    requiresTarget: true,
  },
  {
    // doc 10 §6.3: this one does NOT roll dice. It only performs the entrance;
    // the result belongs to roll_dice and the dice_result frame.
    id: 'roll_ceremony',
    purpose: 'A large die rolls into frame; it does not show a result.',
    params: z
      .object({
        dice: z.string().optional(),
        anticipation: z.number().optional(),
      })
      .passthrough(),
    defaultDuration: 2200,
    requiresTarget: false,
  },
];

export type ShowKind = (typeof SHOWS)[number]['id'];

/** ids in registry order — used by the E5 error copy and `listPerformances`. */
export const SHOW_IDS: string[] = SHOWS.map((s) => s.id);
