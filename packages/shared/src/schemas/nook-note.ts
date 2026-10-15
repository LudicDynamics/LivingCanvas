import { z } from 'zod';

/**
 * The player Nook note transport shape.
 *
 * The transport deliberately has no path, frontmatter, link, or actor fields:
 * the server owns the destination and actor so a browser cannot turn this seam
 * into a general filesystem or god-mode write.
 */
export const NookNoteInputSchema = z.object({
  characterId: z.string().min(1),
  title: z.string().refine((value) => value.trim() !== '', 'title must be non-empty'),
  body: z.string().refine((value) => value.trim() !== '', 'body must be non-empty'),
  clientRef: z.string().min(1).optional(),
}).strict();
export type NookNoteInput = z.infer<typeof NookNoteInputSchema>;

/**
 * Stable success details returned by POST /api/nook-note. `ok` is the HTTP
 * envelope; this schema describes the domain outcome itself.
 */
export const NookNoteOutcomeSchema = z.object({
  path: z.string().regex(/^characters\/[a-z0-9][a-z0-9-]*\/\d+-[a-z0-9-]+\.md$/),
  eventSeq: z.number().int().positive(),
  actor: z.object({ type: z.literal('player') }).strict(),
  created: z.literal(true),
}).strict();
export type NookNoteOutcome = z.infer<typeof NookNoteOutcomeSchema>;
