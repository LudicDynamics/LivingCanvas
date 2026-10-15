/**
 * The small dot on the ONE account entry: something can be claimed —
 * a billing reward in `claimable`, or today's free allowance not yet claimed. A reward billing still verifies
 * (「玩一会儿后解锁」) is not claimable and lights nothing.
 *
 * Where it may show: the lobby's 「账号」 pill, the world header's account icon (the header is closed on entry) and
 * the 「账号」 line inside the player panel (open only when asked). Never on the player orb or anything else that is
 * on screen when a world is first seen — 「第一眼看过去不能有 HUD」.
 */
import { useCallback, useEffect, useState } from 'react';
import { accountData, rewardState, type DailyAllowance, type Reward } from './account-data.js';
import { ACCOUNT_CHANGED_EVENT } from './account-open.js';

/** Fired on window after a claim (daily / reward): dots re-read. */
export const REWARDS_CHANGED_EVENT = 'airp:rewards-changed';

export type DotSurface = 'lobby' | 'world-header' | 'world-menu' | 'world-orb';

export interface DotInputs {
  rewards: readonly Pick<Reward, 'state' | 'status'>[] | null;
  daily: Pick<DailyAllowance, 'claimable'> | null | undefined;
  surface: DotSurface;
}

export function claimableCount(input: Pick<DotInputs, 'rewards' | 'daily'>): number {
  const rewards = (input.rewards ?? []).filter((r) => rewardState(r) === 'claimable').length;
  return rewards + (input.daily?.claimable ? 1 : 0);
}

/** Show the dot? Never on a surface that is on screen at a world's first look. */
export function accountDotVisible(input: DotInputs): boolean {
  if (input.surface === 'world-orb') return false;
  return claimableCount(input) > 0;
}

export function announceRewardsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REWARDS_CHANGED_EVENT));
}

/** Read rewards + today's allowance (signed out / no billing → nothing) and re-read on account / claim changes. */
export function useAccountDot(surface: DotSurface): boolean {
  const [state, setState] = useState<Pick<DotInputs, 'rewards' | 'daily'>>({ rewards: null, daily: null });
  const load = useCallback(async () => {
    const data = accountData();
    if (!data) { setState({ rewards: null, daily: null }); return; }
    const [rewards, usage] = await Promise.all([data.rewards().catch(() => null), data.loadUsage().catch(() => null)]);
    setState({ rewards: rewards ?? null, daily: usage?.wallet?.daily ?? null });
  }, []);
  useEffect(() => {
    if (surface === 'world-orb') return;
    void load();
    const again = () => void load();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, again);
    window.addEventListener(REWARDS_CHANGED_EVENT, again);
    return () => {
      window.removeEventListener(ACCOUNT_CHANGED_EVENT, again);
      window.removeEventListener(REWARDS_CHANGED_EVENT, again);
    };
  }, [load, surface]);
  return accountDotVisible({ ...state, surface });
}
