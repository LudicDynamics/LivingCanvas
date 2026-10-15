import { z } from 'zod';
export const AgentModelSelectionSchema = z.object({
  role: z.enum(['writer', 'character']),
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  thinking: z.enum(['off', 'low', 'medium', 'high']),
  world: z.string().min(1),
}).strict();
