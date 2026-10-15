/**
 * The bundled plan key visuals (lib/plan-art.ts): Vite resolves the glob at
 * build time to hashed asset URLs, so a file added under src/assets/plans/
 * shows up without a code change (a look folder <art>/m|f/ too). Kept apart from plan-art.ts so node tests
 * import that without Vite.
 */
export const PLAN_ART_FILES = import.meta.glob(['../assets/plans/*/*.webp', '../assets/plans/*/[mf]/*.webp'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
