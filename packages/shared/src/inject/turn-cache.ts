/**
 * 01 — 轮边界的单槽状态块缓存（00 §9.2 / 01 §3.2）。
 *
 * 键 = `sessionId`。**一个槽、轮边界无条件覆写**：没有 LRU、没有历史——我们不留
 * 任何可比对的东西（每轮全量、无指纹），所以既没有可淘汰的、也没有可泄漏的。长驻
 * 多会话进程只需要最新一块。
 *
 * 模块级状态是 **per-extension-file**，不是 per-process：pi-rp 对每个扩展文件各建
 * 一个 `createJiti(..., { moduleCache: false })`（`loader.ts:503-509`，调用点
 * `:556`）——00 §9。只有 `extensions/context.ts` 读这个模块，所以单槽是安全的。
 */
interface Slot {
  sessionId: string;
  /** 永不 `''`（见 `renderState` 的"永不返空串"约束，01 §4.3）。 */
  text: string;
}

let slot: Slot | null = null;

/** 每 run 调一次，在 `agent_start` 边界（06 §4.1）。`null` = 组装失败，本轮不注入。 */
export function writeTurnBlock(sessionId: string, text: string | null): void {
  slot = text === null ? null : { sessionId, text };
}

/** 纯内存读取。`null` = 无槽，或槽属于另一个会话 → 不注入（不重算，01 §3.4）。 */
export function readTurnBlock(sessionId: string): string | null {
  return slot !== null && slot.sessionId === sessionId ? slot.text : null;
}

/** 测试缝（`resetTurnStateMemory` 的同构做法，只是没有会话表）。 */
export function resetTurnCacheForTests(): void {
  slot = null;
}

/**
 * 00 §2 约束 4 / 01 §3.3 — the injection gate: is this the FIRST provider
 * request of the current trace?
 *
 * The engine resets its own `turnIndex` to 0 at `agent_start`
 * (`agent-session.ts:1032-1033`) and increments it after each `turn_end`
 * (`:1064-1074`); every tool-loop continuation therefore carries >= 1
 * (`:1055-1061`). So a pure equality check needs no consumption latch —
 * `previewPrompt()` (`agent-session.ts:1850-1857`), which fires neither
 * `agent_start` nor `turn_start`, can never consume the block.
 */
export const FIRST_PROVIDER_TURN_INDEX = 0;

export function isFirstProviderRequest(turnIndex: number): boolean {
  return turnIndex === FIRST_PROVIDER_TURN_INDEX;
}
