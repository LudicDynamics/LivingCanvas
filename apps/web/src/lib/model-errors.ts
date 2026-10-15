/**
 * Writer / character errors from the Worldlines model gateway (browser mode on
 * canvas.worldlines.gg, apps/browser-runtime/src/platform/model-gateway.ts)
 * arrive as raw provider text ("429: {…quota_exceeded…}"). This turns the ones
 * a player can act on into a plain sentence (a messages.json key); anything
 * else → null, and the raw text is shown as before.
 */
/** Billing stops a media route / tool reports as an `airp:notice` detail (apps/server/src/ai-gateway.ts AiBillingStop). */
export type BillingStop = 'quota_exceeded' | 'claim_required' | 'insufficient_credits' | 'debt_limit';
export const isBillingStop = (code: unknown): code is BillingStop =>
  code === 'quota_exceeded' || code === 'claim_required' || code === 'insufficient_credits' || code === 'debt_limit';
export const CREDITS_SHORT = 'Not enough credits to go on. Redeem a code or upgrade your plan in your account.';
/** 402 with reason debt_limit: the balance is below the debt limit (top up / redeem; a plan alone does not lift it). */
export const CREDITS_PAUSED = 'Your balance is paused until it is topped up. Open your account to top up or redeem a code.';
/** Which card a billing notice gets (ClaimPrompt): the claim button, the account card, or none. */
export function creditsStopOf(text: unknown): 'claim_required' | 'debt_limit' | 'insufficient_credits' | null {
  const s = String(text ?? '');
  if (/claim_required/.test(s)) return 'claim_required';
  if (/debt_limit/.test(s)) return 'debt_limit';
  if (/insufficient_credits/.test(s)) return 'insufficient_credits';
  return null;
}

export function friendlyModelError(text: string): string | null {
  // the server's no-model gate (no key, no account, no gateway): the settings notice opens alongside.
  if (/^No model is (configured|set up)\b/.test(text)) return 'No model is set up yet. Add a model API key in Settings to talk to the characters.';
  // 「使用本机密钥」: the player's own provider refused their key (apps/browser-runtime/src/platform/local-key.ts).
  if (/local_key_refused|refused by the model provider \(local key/i.test(text)) return 'Your own API key was refused by the provider. Check it in the account panel, or switch back to Worldlines credits.';
  // billing enforcing credits: today's claim-only allowance is not claimed yet (ClaimPrompt offers the button).
  if (/claim_required/.test(text)) return "Today's free credits are waiting. Claim them to go on.";
  // the wallet cannot pay (402 insufficient_credits): ClaimPrompt offers the account's redeem / plans.
  if (/debt_limit/.test(text)) return CREDITS_PAUSED;
  if (/insufficient_credits/.test(text)) return CREDITS_SHORT;
  // billing cannot be asked and the product fails closed (ai 503 billing_unavailable)
  if (/billing_unavailable/.test(text)) return 'Credits cannot be checked right now. Try again in a moment.';
  if (/quota_exceeded|quota exceeded/i.test(text)) return "Your Worldlines plan's model quota is used up for now. It resets on its own — try again later.";
  if (/auth_required/.test(text)) return 'Sign in to your account to continue the story.';
  if (/model stream was cut/.test(text)) return 'The connection to the model was cut. Send your action again.';
  return null;
}
