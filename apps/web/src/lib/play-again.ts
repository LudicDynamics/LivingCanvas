/**
 * 「再玩一次」 from the account popup's 我的记录 tab: ask the app to start a new run of a
 * world's template. The app listens (App.tsx → playWorld, which keeps the sign-in gate); nothing else starts worlds.
 */
export const PLAY_WORLD_EVENT = 'airp:play-world';

export function requestPlayWorld(path: string): void {
  if (typeof window !== 'undefined' && path) window.dispatchEvent(new CustomEvent<string>(PLAY_WORLD_EVENT, { detail: path }));
}

/** Subscribe (App.tsx). → unsubscribe. */
export function onPlayWorldRequest(play: (path: string) => void): () => void {
  const handler = (e: Event) => { const path = (e as CustomEvent<string>).detail; if (typeof path === 'string' && path) play(path); };
  window.addEventListener(PLAY_WORLD_EVENT, handler);
  return () => window.removeEventListener(PLAY_WORLD_EVENT, handler);
}
