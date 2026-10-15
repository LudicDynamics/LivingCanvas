import { z } from 'zod';

/**
 * POST /api/tts body. `savePath` is captured from WorldLoadResult.path by the
 * browser and is scope evidence only: the server must still match its active
 * canonical world root before reading character data or touching the cache.
 */
export const TtsRequestSchema = z.object({
  text: z.string(),
  savePath: z.string().min(1),
  voice: z.string().optional(),
  language: z.string().optional(),
  characterId: z.string().optional(),
  emotion: z.string().optional(),
}).strict();

export type TtsRequest = z.infer<typeof TtsRequestSchema>;
