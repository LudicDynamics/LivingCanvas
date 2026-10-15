/**
 * 01 — 轮边界采集器与备忘录（01 §4.1/§4.4/§4.5/§4.7）。
 *
 * 这是唯一有 I/O 的注入模块：一次 `getManifest`、一次视点读、一次事件读，
 * 全部在**轮边界**（`agent_start`）跑一次（00 §2.2）。`context` handler 只读缓存串。
 *
 * 依赖是单向的：本模块 import `render/events.js` 的**运行时** `renderEventWindow`，
 * 所以 `EventSlice` / `EventWindow` 由 03 声明在 `render/events.ts`，绝不反向。
 */
import type { Actor } from '../actions/actor.js';
import { resolveHome } from '../actions/presence.js';
import type { WorldEvent } from '../schemas/events.js';
import { dirOfLayer, MAP_LAYER } from '../store/layers.js';
import type { LocalWorldStore } from '../store/local-store.js';
import type { LayerConfig } from '../schemas/world.js';
import type { ViewpointRecord } from '../store/world-store.js';
import type { NextStepFacts } from '../render/next-step.js';
import {
  renderEventWindow,
  type EventSlice,
  type EventWindow,
} from '../render/events.js';
import type { Section } from '../render/state.js';
import { WORLD_COMMAND_EFFECT_BUDGET } from '../commands/limits.js';
import { SECTION_CAPS, type SectionCaps, type SectionSpec } from '../render/sections.js';

/** 05 的类型由本模块 re-export（02 §2.1 如此引用）。 */
export type { ViewpointRecord };

/** What 02's collectors receive. Frozen with 02 (2026-09-12). */
export interface SectionDeps {
  store: LocalWorldStore;
  actor: Actor;
  /** `readerOfActor(actor)`; null = never reads events. */
  reader: string | null;
  /** 轮边界解析一次（§4.4）；writer 派生自 `viewport.layer`，角色派生自 presence/home。 */
  layer: string | null;
  /** 视点行（05）。null = 缺席 / TTL 过期。角色侧只许读 `.layer`（§4.4 更正）。 */
  viewport: ViewpointRecord | null;
  /** 一次性时钟读。 */
  now: number;
  caps: SectionCaps;
  /**
   * `{ [layerId]: displayName }`，轮边界从 `store.getManifest().layers` 建一次
   * （`local-store.ts:320`；与 `presence.ts::readLayerName` 同源）。03 的渲染器靠它把
   * **层 id** 印成显示名（评审 A-17）。
   */
  layerNames: Record<string, string>;
  /** MEMOISED：每轮恰好一次事件读，dynamics 与 next_step 共享。 */
  events(): Promise<EventSlice>;
  /** MEMOISED：同一底层读的合并 / 开窗 / 渲染结果（03）。 */
  eventWindow(): Promise<EventWindow>;
}

/** `collectSections` 的实参 = `SectionDeps` + 分节表（02 的 `sectionsFor(actor)`）。 */
export interface CollectContext extends SectionDeps {
  specs: readonly SectionSpec[];
}

/** 按消息首参去重，每进程每类只写一次 stderr（逐轮 warn 会刷屏；对照 `toolkit/actor.ts`）。 */
const warned = new Set<string>();
export function warnOnce(message: string, err?: unknown): void {
  if (warned.has(message)) return;
  warned.add(message);
  const detail = err === undefined ? '' : `: ${err instanceof Error ? err.message : String(err)}`;
  process.stderr.write(`${message}${detail}\n`);
}

/**
 * 层 id → 显示名的映射，只建一次（§4.7）。命中 `name` 即用；缺 `name` 的 stub 层与
 * `presence.ts:112-121 readLayerName` 的回落**同口径**（末段目录名）。
 *
 * `map` 例外：`layerPhrase` 自己拥有"the world map"这句人话（03 §3.3.1），所以没有
 * manifest 名时**不放进映射**，把措辞留给渲染器——否则这里会印出一个裸 `map`。
 */
export function layerNameMap(
  layers: Record<string, LayerConfig | undefined>
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [id, config] of Object.entries(layers ?? {})) {
    const name = config?.name;
    if (typeof name === 'string' && name.trim() !== '') {
      names[id] = name.trim();
      continue;
    }
    if (id === MAP_LAYER) continue;
    const dir = dirOfLayer(id);
    const last = dir.split('/').pop();
    if (last && last !== '') names[id] = last;
  }
  return names;
}


/**
 * 每轮**唯一**的事件读（§4.4）。
 *
 * 热路径必须**先限量再取**（评审 A-9）：`getEventsSince` 的 `limit` 走内侧
 * `ORDER BY seq DESC LIMIT ?` + 外侧 ASC，读多少由 `caps` 决定，不随会话长度增长。
 * 冷启动必须**按层查**（评审 A-2）：`getEvents(caps, { layer })` 走 `idx_events_layer`，
 * 不许"全局取 N 再 JS 过滤本层"。
 */
export async function readEventSlice(
  store: LocalWorldStore,
  reader: string,
  opts: { layer?: string; excludeActor: Actor; caps: number }
): Promise<EventSlice> {
  const cursor = await store.readCursor(reader); // 0 = "from genesis"
  if (cursor > 0) {
    const events = await store.getEventsSince(cursor, {
      layer: opts.layer,
      excludeActor: opts.excludeActor,
      limit: opts.caps,
    });
    return { events, coldStart: false };
  }
  // writer：全局最近 caps 条；角色：本层最近 caps 条。
  const desc =
    opts.layer === undefined
      ? await store.getEvents(opts.caps)
      : await store.getEvents(opts.caps, { layer: opts.layer });
  const asc = desc.slice().reverse();
  // JS 侧排他只在冷启动需要（`getEvents` 没有 `excludeActor`）；热路径由 SQL 排他。
  return {
    events: asc.filter(
      (e) =>
        !(e.actor.type === opts.excludeActor.type && (e.actor.id ?? '') === (opts.excludeActor.id ?? ''))
    ),
    coldStart: true,
  };
}

/**
 * `layer_*` 三条里，"刚生成、玩家尚未进入"的判据（§4.5 / 04 §2.2）：存在一条
 * `layer_initialized` / `layer_init_failed` 的层 L，其后没有 `layer_entered` 指向 L，
 * 且 `L !== currentLayer`。`layer` 同时读事件行的列与 `detail.layer`（两条都设）。
 */
function hasUnseenCreation(events: readonly WorldEvent[], currentLayer: string | null): boolean {
  const unseen = new Set<string>();
  for (const e of events) {
    const detailLayer = e.detail?.layer;
    const layer = e.layer ?? (typeof detailLayer === 'string' ? detailLayer : null);
    if (layer === null) continue;
    if (e.type === 'layer_initialized' || e.type === 'layer_init_failed') {
      unseen.add(layer);
      continue;
    }
    // 之后的 `layer_entered` 表示有人（通常是玩家）已经进去了。
    if (e.type === 'layer_entered') unseen.delete(layer);
  }
  for (const layer of unseen) {
    if (layer !== currentLayer) return true;
  }
  return false;
}

/**
 * 组装 04 的冻结 facts 结构，复用节采集用过的**同一份备忘录读取**（04 §2.2）。
 */
export async function buildNextStepFacts(
  deps: SectionDeps,
  // The sections are not read here (facts come from the event window); the
  // parameter is part of the frozen signature (01 §4.5) and documents the seam.
  _sections: readonly Section[]
): Promise<NextStepFacts> {
  const window = await deps.eventWindow();
  const slice = await deps.events(); // the same memoised read, so it is free
  return {
    // `EventWindowLine` is structurally a superset of `NextStepEvent` (03 freezes
    // the projection), so `window.events` is handed over as-is.
    role: deps.actor.type === 'character' ? 'character' : 'writer',
    events: window.events,
    currentLayer: deps.layer,
    unseenCreation: hasUnseenCreation(slice.events, deps.layer),
    // `quiet` is decided by the event window ALONE (review A-1): conjoining
    // `sections.length === 0` is dead code — that state is already short-circuited
    // into the sentinel by `renderState`.
    quiet: window.events.length === 0,
  };
}

/**
 * 跑完全部 spec，按表序，每节各自 try/catch（第一层）。返回 null 的 spec 什么都不贡献
 * （第二层）。单节失败**永不抛**；首次失败时写一行 `warnOnce` 到 stderr。
 */
export async function collectSections(ctx: CollectContext): Promise<Section[]> {
  const out: Section[] = [];
  for (const spec of ctx.specs) {
    try {
      const section = await spec.collect(ctx);
      if (section && section.text.trim() !== '') out.push(section); // 空节整节缺席
    } catch (err) {
      warnOnce(`[airp/context] section "${spec.key}" failed`, err);
    }
  }
  return out;
}

/**
 * 轮边界的层解析（§4.4）：writer 取视点层，角色取 presence 行、无行则 `resolveHome`。
 * 空串层**显式**回落 `null`（评审 A-20：`?? null` 只吞 null/undefined，会让合法空串层
 * 穿过所有 `deps.layer === null` 守卫）。
 */
async function resolveTurnLayer(
  store: LocalWorldStore,
  actor: Actor,
  viewport: ViewpointRecord | null
): Promise<string | null> {
  if (actor.type !== 'character') {
    const layer = viewport?.layer;
    return layer === undefined || layer === '' ? null : layer;
  }
  const id = actor.id ?? '';
  const placed = id === '' ? null : store.getPresenceOf(id)?.layer;
  if (placed !== undefined && placed !== null && placed !== '') return placed;
  return (await resolveHome(store, id)).layer || null;
}

/**
 * 玩家便签与线索板是玩家自己的推理（the design notes）：作家看得到，
 * 角色看不到——否则 NPC 会"读到"玩家的私人笔记。只过滤渲染，不改读取与游标。
 */
function withoutPlayerBoard(slice: EventSlice): EventSlice {
  return {
    ...slice,
    events: slice.events.filter((e) => e.type !== 'player_board_changed' && e.detail?.playerNote !== true),
  };
}

/**
 * 为一个轮次建好带备忘录的 deps，轮边界调一次。
 *
 * `layerNames` 不是选项：本函数自己从 `(await store.getManifest()).layers` 建一次
 * （评审 A-17）。`deps.layer` 也在这里解析一次（§4.4）。两处读取（manifest、视点）
 * 各一次，事件读取收在 `events()` / `eventWindow()` 的同一个 promise 里（§4.7）。
 */
export async function makeSectionDeps(opts: {
  store: LocalWorldStore;
  actor: Actor;
  reader: string | null;
  specs: readonly SectionSpec[];
  caps?: SectionCaps;
  now?: number;
}): Promise<CollectContext> {
  const { store, actor, reader, specs } = opts;
  const now = opts.now ?? Date.now();
  const caps = opts.caps ?? SECTION_CAPS;
  // 两种角色**都**读视点（§4.4 更正，L3 实施反馈）：差别在消费方——作家渲染
  // focus/selected，角色的 `standing` 只拿 `.layer` 比较"玩家层 vs 角色层"（A-5）。
  const viewport = store.readViewpoint(now);
  const layer = await resolveTurnLayer(store, actor, viewport);
  const layerNames = layerNameMap((await store.getManifest()).layers);

  let slicePromise: Promise<EventSlice> | null = null;
  let windowPromise: Promise<EventWindow> | null = null;

  const events = (): Promise<EventSlice> =>
    reader === null
      ? Promise.resolve<EventSlice>({ events: [], coldStart: false })
      : (slicePromise ??= readEventSlice(store, reader, {
          // 层过滤**只对角色**（00 §6.1）：作家读全天下的 dynamics。
          layer: actor.type === 'character' ? (layer ?? undefined) : undefined,
          excludeActor: actor,
          // READ budget ≠ RENDER cap (10 §2.6 / M-9). One trigger can append up
          // to `WORLD_COMMAND_EFFECT_BUDGET` events, and they are NEWER than
          // everything else, so at `caps.dynamics` they would eat the read slots
          // and push older facts out of the slice entirely — where nothing could
          // even count them: `dropped` only counts what the RENDER cap folded.
          // Gone from the read + cursor advanced (`cursor.ts`) = gone for good.
          // `renderEventWindow` below keeps `caps.dynamics`: only the READ grows.
          //
          // HARD PREREQUISITE (10 §2.6 ⚠️): the constant is an upper bound on
          // EXPANDED events, because `03` counts `list-args` array lengths during
          // pre-flight (`n = Σ_steps (array length or 1)`). Move that expansion
          // out of pre-flight and this guard silently stops covering a burst.
          caps: caps.dynamics + WORLD_COMMAND_EFFECT_BUDGET,
        }));

  const eventWindow = (): Promise<EventWindow> =>
    (windowPromise ??= events().then((slice) =>
      renderEventWindow(actor.type === 'character' ? withoutPlayerBoard(slice) : slice, { caps: caps.dynamics, actor, layerNames })
    ));

  return { store, actor, reader, layer, viewport, now, caps, layerNames, events, eventWindow, specs };
}
