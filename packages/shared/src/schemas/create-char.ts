import { z } from 'zod';
import { isValidCharacterId } from '../rules/characters.js';

/** Public payload for the Writer-only create_char action. */
export const CreateCharInputSchema = z.object({
  id: z.string().trim().refine(isValidCharacterId, 'id must be lower-kebab-case'),
  name: z.string().min(1, 'name must not be empty'),
  desc: z.string().min(1, 'desc must not be empty'),
  avatar: z.string().trim().min(1, 'avatar must not be empty'),
  identity: z.string().optional(),
  personality: z.string().optional(),
  memory: z.string().optional(),
  voice: z.string().trim().min(1).optional(),
}).strict();

export type CreateCharInput = z.infer<typeof CreateCharInputSchema>;
