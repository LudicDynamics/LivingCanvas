/**
 * 01 — 状态块的装配器（00 §3.1 形状 / §4.1 线格式 / §4.3 空注入）。
 *
 * 纯、同步、无 I/O、无时钟、无模块状态。永不抛，且**永不返回空串**：
 * `readTurnBlock` 用 `null` 表示"别注入"，用字符串表示"注入这段"；若这里可能返回
 * `''`，两者在单槽缓存里就混成一个值（01 §4.3）。
 *
 * 一节 = 一段自足正文：每个 `Section.text` 自带它那行标签（02 §2.1 纪律），本函数
 * **逐字打印 `text`、绝不打印 `title`**（`title` 只给日志 / 测试 / 诊断用）。
 * `next_step` 不是节表成员（00 §8）：它是 `computeNextStep(facts)` 的产物，作为
 * **无标签末节**追加，永远最后。
 */
import type { NextStepFacts } from './next-step.js';
import { computeNextStep } from './next-step.js';

/** 00 §3.1。`key` 是冻结字符串（闭集在 02 的 `SectionKey`，本文件不重复声明）；`title` 只做元数据；`text` 自足。 */
export interface Section {
  key: string;
  title: string;
  text: string;
  items?: string[];
}

/** 00 §4.1 —— 探针计数用的冻结标记（06 §6.3 A1）。 */
export const STATE_HEADER = '[World state]';
/** 一节都没有、且 `next_step` 也为空时，作家侧的整块兜底（00 §4.3）。 */
export const STATE_EMPTY_WRITER = '[World state: nothing to report yet]';
/** 同上，角色版措辞（00 §4.3）。 */
export const STATE_EMPTY_CHARACTER = '[World state: nothing has happened here yet]';

/**
 * 渲染本轮的自足状态块（00 §1：每轮都是**全量**块，无 diff、无指纹）。
 *
 * @param sections 02 的分节表按表序产出的节；空节已在 `collectSections` 二期缺席。
 * @param facts    04 的 `NextStepFacts`；`facts.role` 同时选空块措辞。
 */
export function renderState(sections: readonly Section[], facts: NextStepFacts): string {
  // 防空节：`body === ''` 当且仅当没有任何节带正文。
  const body = (sections ?? []).map((s) => s.text).join('\n\n');
  const next = computeNextStep(facts); // '' = 本轮无所欠
  // 求值顺序即优先级（01 §4.5）：全空世界走哨兵，有节但无事发生走 quiet 正文。
  // `facts` 的读取保持可选：契约要求本函数 total（永不抛），半成品 facts 必须降级。
  if (body === '' && next === '') {
    return facts?.role === 'character' ? STATE_EMPTY_CHARACTER : STATE_EMPTY_WRITER;
  }
  const parts = [body, next].filter((p) => p !== '');
  return `${STATE_HEADER}\n\n${parts.join('\n\n')}`;
}
