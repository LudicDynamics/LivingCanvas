/**
 * One colour per agent, shared by the real pointers (AgentCursorLayer) and the
 * ambient ones (AmbientLayer), so a character's hand is the same colour whether
 * it is acting for real or idling. The writer keeps the house rust (no hue).
 */
export const CHARACTER_HUES = ['#4f7a5f', '#46708a', '#8a557c', '#94702b', '#6a5f9c'] as const;

export function agentHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

export function characterHue(characterId: string): string {
  return CHARACTER_HUES[Math.abs(agentHash(characterId)) % CHARACTER_HUES.length];
}
