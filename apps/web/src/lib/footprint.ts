/**
 * Footprint measurement + report scheduler.
 *
 * This is the ONLY path that turns "the height the browser actually painted"
 * into persisted data. It is deliberately a pure unit: time and every side
 * effect are injected, so the "do not report while streaming" rule can be
 * verified with a fake clock and no DOM (`footprint-scheduler.test.mjs`).
 */

/** One reported box. `h` is measured; `w` is echoed from the items (contract §3.3). */
export interface FootprintBox {
  path: string;
  w: number;
  h: number;
}

export interface FootprintResult {
  readonly at: number;
  readonly ok: boolean;
  readonly layer: string;
  readonly updated?: number;
  readonly unchanged?: number;
  readonly error?: string;
}

export interface FootprintSchedulerOptions {
  /** Read at arm time AND re-checked at flush (layer-switch race guard, F3⑤). */
  layer: () => string;
  /** path → echoed width (from items; never independently measured, 04 §3.5). */
  widths: () => ReadonlyMap<string, number>;
  /** Synchronous DOM read: path → offsetHeight. Wire to `measureHeights`. */
  measure: () => Map<string, number>;
  post: (layer: string, boxes: FootprintBox[]) => Promise<{ updated: number; unchanged: number }>;
  /** A writer tool is in flight (F3②). */
  isBusy: () => boolean;
  /** A card drag session is running (F3③). */
  isDragging: () => boolean;
  /** Optional whole-canvas gate. Inflated cards are individually omitted by measureHeights. */
  isHovering?: () => boolean;
  /** Default: `document.hidden` (F3④). */
  isHidden?: () => boolean;
  debounceMs?: number;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  onResult?: (r: { layer: string; updated: number; unchanged: number }) => void;
  onError?: (e: unknown) => void;
}

export interface FootprintScheduler {
  /** A size changed: arm/extend the tail debounce. */
  notify(): void;
  /** Layer switch: drop the pending packet + reset the fingerprint. */
  reset(layer: string): void;
  /** Try to flush now (still gate-constrained). */
  flushNow(): void;
  readonly last: FootprintResult | null;
  dispose(): void;
}

/** A lost `tool_end` cannot keep the channel quiet forever (F3 hysteresis guard). */
const BUSY_MAX_MS = 30_000;

/**
 * True while a shell is in an *inflated* interaction state whose rendered box
 * no longer equals its declared card box — hover (chalk status header opens,
 * +86px) or the persistent `reading` panel. Both are exempt from measurement
 * (contract §3.5). This is the single predicate: `measureHeights` and the
 * scheduler's `isHovering` gate MUST agree, so new inflating states go here.
 */
export function isInflated(el: HTMLElement): boolean {
  return el.matches(':hover') || el.hasAttribute('data-reading');
}

/**
 * Measure rendered card heights for the footprint round-trip. Keys are
 * world-relative paths. `offsetHeight` is untransformed layout px — `rect` is
 * zoom-scaled and MUST NOT be used (04 §3.1). Zero-height and inflated shells
 * are omitted: 0 is not a real height, and an inflated box is not the declared
 * one (contract §3.5).
 */
export function measureHeights(root: ParentNode = document): Map<string, number> {
  const out = new Map<string, number>();
  const shells = root.querySelectorAll<HTMLElement>('.object[data-path]');
  shells.forEach((el) => {
    const path = el.dataset.path;
    if (!path) return;
    if (isInflated(el)) return; // inflated box must not become the truth
    const h = el.offsetHeight;
    if (!(h > 0)) return; // display:none / not mounted yet → not a measurement
    out.set(path, h);
  });
  return out;
}

/**
 * Tail-debounced reporter. See the design notes (F1–F7).
 *
 * Gates, in order: layer unchanged → page visible → writer idle → not dragging
 * → nothing hovered → measure → dedupe fingerprint → POST.
 */
export function createFootprintScheduler(opts: FootprintSchedulerOptions): FootprintScheduler {
  const debounceMs = opts.debounceMs ?? 200;
  const now = opts.now ?? (() => performance.now());
  const setTimer = opts.setTimeout ?? setTimeout;
  const clearTimer = opts.clearTimeout ?? clearTimeout;
  // Hover expands a card's presentation layer. Treating that transient box as
  // a stable footprint makes the next fetch/reseat move cards under the
  // pointer; the next quiet window after pointerleave measures it instead.
  const isHovering = opts.isHovering ?? (() => (
    typeof document !== 'undefined' && document.querySelector('.object:hover') !== null
  ));
  const isHidden = opts.isHidden ?? (() => document.hidden);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let armedLayer: string | null = null;
  let lastSent: { layer: string; fingerprint: string } | null = null;
  let busySince: number | null = null;
  let warnedBusy = false;
  let disposed = false;
  let last: FootprintResult | null = null;

  function warn(message: string, err?: unknown): void {
    if (opts.onError) opts.onError(err ?? message);
    else console.warn(message, err ?? '');
  }

  /** Busy, with the stale-counter guard: a lost `tool_end` cannot silence us. */
  function writerBusy(): boolean {
    if (!opts.isBusy()) {
      busySince = null;
      warnedBusy = false;
      return false;
    }
    if (busySince === null) busySince = now();
    if (now() - busySince > BUSY_MAX_MS) {
      if (!warnedBusy) {
        console.warn('[footprint] writer busy > 30s — assuming a lost tool_end; measuring anyway');
        warnedBusy = true;
      }
      return false;
    }
    return true;
  }

  function arm(layer: string): void {
    armedLayer = layer;
    pending = true;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(flush, debounceMs);
  }

  function blocked(): boolean {
    if (isHidden()) return true;
    if (writerBusy()) return true;
    if (opts.isDragging()) return true; // offsetHeight during a drag = forced reflow (§7.6 ③)
    return isHovering();
  }

  function flush(): void {
    timer = null;
    if (disposed || !pending) return;

    // Layer switch inside the debounce window: the packet is for a layer the
    // player already left. Drop it (reset() re-arms for the new layer).
    if (armedLayer === null || opts.layer() !== armedLayer) {
      pending = false;
      return;
    }

    if (blocked()) {
      // Keep the packet but try again after another quiet window: the writer
      // stops, the drag ends, the pointer leaves. Never post a mid-state height.
      timer = setTimer(flush, debounceMs);
      return;
    }

    pending = false;
    const heights = opts.measure();
    const widths = opts.widths();
    // Keep retrying omitted (hovered/reading) cards without starving new cards
    // elsewhere. Their height may not change when the pointer leaves.
    if ([...widths.keys()].some(path => !heights.has(path))) arm(opts.layer());
    const boxes: FootprintBox[] = [];
    for (const [path, h] of heights) {
      const w = widths.get(path);
      if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) continue;
      boxes.push({ path, w, h });
    }
    if (boxes.length === 0) return;
    boxes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    // Fingerprint gate (F6): the second half of the anti-self-activation lock.
    // Writing canvas.db makes fs.watch fire file_changed → fetchLayer → remount
    // observers → remeasure; without this, a sub-pixel wobble re-posts forever.
    const fingerprint = JSON.stringify(boxes);
    if (lastSent !== null && lastSent.layer === armedLayer && lastSent.fingerprint === fingerprint) {
      return;
    }

    const layer = armedLayer;
    void opts
      .post(layer, boxes)
      .then((r) => {
        lastSent = { layer, fingerprint };
        last = { at: now(), ok: true, layer, updated: r.updated, unchanged: r.unchanged };
        opts.onResult?.({ layer, updated: r.updated, unchanged: r.unchanged });
      })
      .catch((err: unknown) => {
        // Never silent (§7): the local measure cache still serves collisions, so
        // the UI is fine — but a broken channel must be visible in the console.
        warn('[footprint] POST failed', err);
        last = { at: now(), ok: false, layer, error: err instanceof Error ? err.message : String(err) };
      });
  }

  return {
    notify(): void {
      if (disposed) return;
      arm(opts.layer());
    },
    reset(layer: string): void {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = false;
      armedLayer = layer;
      lastSent = null;
    },
    flushNow(): void {
      if (disposed) return;
      pending = true;
      flush();
    },
    get last(): FootprintResult | null {
      return last;
    },
    dispose(): void {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = false;
    },
  };
}
