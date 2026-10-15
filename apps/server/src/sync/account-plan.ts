import { accountSignedIn } from '../ai-gateway.js';

/**
 * The signed-in account's plan on the Worldlines AI service (`free`, `story`, `vivid`, …), as the account panel
 * last read it (account-data.ts `usage()`, GET ai /usage/me). For decisions that only pick a better option when
 * the plan allows it (engine/world-models.ts): unknown, signed out or a guest → null (= treated as free).
 */
let remembered: string | null = null;

export function rememberAccountPlan(plan: string | null | undefined): void {
  if (typeof plan === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(plan)) remembered = plan;
}
export function accountPlan(): string | null {
  return accountSignedIn() ? remembered : null;
}
/** Tests / sign-out. */
export function forgetAccountPlan(): void {
  remembered = null;
}
