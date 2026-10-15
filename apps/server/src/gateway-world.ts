/**
 * X-Worldlines-World on calls to the Worldlines AI service (ai.worldlines.gg).
 * Every call to the service while a world is open names it: the bare world id
 * chronicle knows as `livingcanvas/world/<id>` (account-data.ts reportTurn), so
 * billing counts play from calls it served itself (anti-abuse)
 * instead of trusting a reported turn. Never sent to a provider on an own key:
 * those calls do not go through ai-gateway.ts gatewayFetch, and the browser's
 * local-key fetch builds fresh headers. An id that does not fit the pattern is
 * left out, never sent.
 */
export const WORLD_HEADER = 'x-worldlines-world';
export const GATEWAY_WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
let worldSource: () => string | null | undefined = () => null;
/** index.ts: where the open world's id comes from (the active store). */
export function setGatewayWorldSource(source: () => string | null | undefined): void { worldSource = source; }
/** The open world's id, or null (none open / not a usable id). */
export function gatewayWorld(): string | null {
  try {
    const id = worldSource();
    return typeof id === 'string' && GATEWAY_WORLD_ID.test(id) ? id : null;
  } catch { return null; }
}
// The browser runtime's gateway fetch (apps/browser-runtime/src/platform/model-gateway.ts) reads it here.
(globalThis as { __airpGatewayWorld?: () => string | null }).__airpGatewayWorld = gatewayWorld;
