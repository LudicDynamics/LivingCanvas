import { z } from 'zod';

const savePath = z.string().min(1);
const command = <T extends string>(type: T) => ({ type: z.literal(type), savePath });

/** Strict browser/server wire contract for every client → server WS command. */
export const WsCommandSchema = z.discriminatedUnion('type', [
  z.object({
    ...command('writer_prompt'),
    message: z.string(),
    layer: z.string().optional(),
    mode: z.enum(['steer', 'followUp']).optional(),
  }).strict(),
  z.object({
    ...command('airp_init'),
    kind: z.string(),
    target: z.string(),
    by: z.enum(['player', 'engine']).optional(),
    request: z.string().optional(),
    template: z.boolean().optional(),
  }).strict(),
  z.object(command('writer_abort')).strict(),
  z.object(command('abort')).strict(),
  z.object({
    ...command('character_start'),
    characterId: z.string(),
    recentContext: z.string().optional(),
  }).strict(),
  z.object({
    ...command('character_prompt'),
    characterId: z.string(),
    message: z.string(),
    mode: z.enum(['steer', 'followUp']).optional(),
  }).strict(),
  z.object({
    ...command('character_abort'),
    characterId: z.string(),
  }).strict(),
  z.object({
    ...command('character_stop'),
    characterId: z.string(),
    turns: z.number().int().positive().optional(),
    /** How the chat ended, for the writer's summary (lib/chat-end.ts). */
    via: z.enum(['dialogue', 'voice']).optional(),
    /** false while chat beats are held: the summary is recorded without a beat. */
    beat: z.boolean().optional(),
  }).strict(),
  z.object({
    ...command('character_talk_end'),
    characterId: z.string(),
    via: z.enum(['dialogue', 'voice']).optional(),
    beat: z.boolean().optional(),
  }).strict(),
]);

export type WsCommand = z.infer<typeof WsCommandSchema>;
