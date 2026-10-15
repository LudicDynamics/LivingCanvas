import { Buffer } from 'node:buffer';

export const CANVAS_READY_TIMEOUT_MS = 25_000;
export const CANVAS_CAPTURE_TIMEOUT_MS = 30_000;

export class CanvasBrowserError extends Error {
  readonly code: 'unsupported' | 'cancelled' | 'internal';
  readonly details?: Record<string, unknown>;
  constructor(code: CanvasBrowserError['code'], message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CanvasBrowserError';
    this.code = code;
    this.details = details;
  }
}

type Browser = {
  newContext(options: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<BrowserContext>;
};
type BrowserContext = {
  newPage(): Promise<CanvasPage>;
  close(): Promise<void>;
};
type CanvasPage = {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null>;
  waitForSelector(selector: string, options: { state: 'attached'; timeout: number }): Promise<unknown>;
  evaluate<T>(pageFunction: (arg: unknown) => T, arg: unknown): Promise<T>;
  locator(selector: string): { screenshot(options: { type: 'png' }): Promise<Uint8Array> };
  close(): Promise<void>;
};

type PlaywrightModule = {
  chromium?: { launch(options: { headless: boolean }): Promise<Browser> };
};

let browserPromise: Promise<Browser> | null = null;
let gateBusy = false;
const waiters: Array<{
  resolve: (browser: Browser) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}> = [];

function unavailable(message: string): CanvasBrowserError {
  return new CanvasBrowserError('unsupported', `screenshot_canvas unavailable: ${message}`);
}

async function loadBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    let playwright: PlaywrightModule;
    try {
      // Keep Playwright optional at server startup. This indirection also keeps
      // the server build usable in deployments that deliberately omit Chromium.
      const dynamicImport = new Function('specifier', 'return import(specifier)') as (
        specifier: string
      ) => Promise<PlaywrightModule>;
      playwright = await dynamicImport('playwright');
    } catch {
      throw unavailable('Playwright/Chromium is not available.');
    }
    if (!playwright.chromium) throw unavailable('Playwright/Chromium is not available.');
    try {
      return await playwright.chromium.launch({ headless: true });
    } catch {
      throw unavailable('Playwright/Chromium is not available.');
    }
  })();
  try {
    return await browserPromise;
  } catch (error) {
    browserPromise = null;
    throw error;
  }
}

function abortError(beforeStart: boolean): CanvasBrowserError {
  return new CanvasBrowserError(
    'cancelled',
    beforeStart
      ? 'screenshot_canvas cancelled before capture started.'
      : 'screenshot_canvas cancelled during capture.'
  );
}

async function acquire(signal?: AbortSignal): Promise<Browser> {
  if (signal?.aborted) throw abortError(true);
  if (!gateBusy) {
    gateBusy = true;
    return loadBrowser();
  }
  return new Promise<Browser>((resolve, reject) => {
    const waiter = { resolve, reject, signal };
    waiters.push(waiter);
    const onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(abortError(true));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function release(): void {
  const next = waiters.shift();
  if (!next) {
    gateBusy = false;
    return;
  }
  if (next.signal?.aborted) {
    next.reject(abortError(true));
    release();
    return;
  }
  // Keep the gate occupied while handing the same process-level browser to the
  // next request. A failed launch is retried by the next request, never wedging
  // the queue.
  void loadBrowser().then(next.resolve, next.reject);
}

/** Run one browser task under the process-wide serial gate and deadline. */
export async function withCanvasBrowserGate<T>(
  task: (browser: Browser, signal: AbortSignal) => Promise<T>,
  opts: { signal?: AbortSignal; timeoutMs: number }
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.floor(opts.timeoutMs));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', forwardAbort, { once: true });
  let browser: Browser | undefined;
  try {
    browser = await acquire(controller.signal);
    if (controller.signal.aborted) throw abortError(true);
    return await task(browser, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      if (opts.signal?.aborted || !browser) throw abortError(!browser);
      throw abortError(false);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', forwardAbort);
    release();
  }
}

function pngDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.byteLength < 24) return null;
  const bytes = Buffer.from(data);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export type CanvasDomEvidence = {
  renderedGeometry: Array<{ path: string; x: number; y: number; w: number; h: number }>;
  geometryEvidence: 'read' | 'mismatch' | 'unavailable';
};

/** Capture only the AIRP Canvas surface; never screenshots an API response. */
export async function captureCanvasPage(
  browser: Browser,
  input: {
    url: string;
    viewport: { width: number; height: number };
    expectedLayer: string;
    expectedSnapshotId: string;
    expectedPaths: readonly string[];
    timeoutMs?: number;
  },
  signal: AbortSignal
): Promise<{ png: Uint8Array; dimensions: { width: number; height: number }; evidence: CanvasDomEvidence }> {
  const context = await browser.newContext({ viewport: input.viewport, deviceScaleFactor: 1 });
  const timeout = input.timeoutMs ?? CANVAS_READY_TIMEOUT_MS;
  let page: CanvasPage | undefined;
  try {
    page = await context.newPage();

    const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout });
    if (response && response.status() >= 400) {
      throw new CanvasBrowserError('internal', `screenshot_canvas failed: the canvas page returned HTTP ${response.status()}.`);
    }
    if (signal.aborted) throw abortError(false);
    await page.waitForSelector('html[data-airp-canvas-ready="1"]', { state: 'attached', timeout });
    if (signal.aborted) throw abortError(false);
    const evidence = await page.evaluate((arg) => {
      const expectedPaths = new Set((arg as { expectedPaths: string[] }).expectedPaths);
      const root = document.documentElement;
      const surface = document.querySelector<HTMLElement>('[data-airp-canvas-surface]');
      const layer = root.dataset.airpCanvasLayer ?? surface?.dataset.airpCanvasLayer;
      const snapshotId = root.dataset.airpCanvasSnapshot ?? surface?.dataset.airpCanvasSnapshot;
      const error = root.dataset.airpCanvasError ?? surface?.dataset.airpCanvasError;
      if (error) throw new Error('canvas-error');
      if (!surface || layer !== (arg as { expectedLayer: string }).expectedLayer || snapshotId !== (arg as { expectedSnapshotId: string }).expectedSnapshotId) {
        throw new Error('canvas-identity-mismatch');
      }
      const elements = [...surface.querySelectorAll<HTMLElement>('.object[data-path]')];
      const paths = new Set(elements.map((element) => element.dataset.path ?? ''));
      const aligned = paths.size === expectedPaths.size && [...expectedPaths].every((path) => paths.has(path));
      const renderedGeometry = elements
        .map((element) => {
          const path = element.dataset.path;
          const rect = element.getBoundingClientRect();
          return path && Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0
            ? { path, x: rect.x, y: rect.y, w: rect.width, h: rect.height }
            : null;
        })
        .filter((row): row is { path: string; x: number; y: number; w: number; h: number } => row !== null);
      if (!aligned || renderedGeometry.length !== elements.length) throw new Error('canvas-geometry-mismatch');
      return { renderedGeometry, geometryEvidence: 'read' as const };
    }, {
      expectedLayer: input.expectedLayer,
      expectedSnapshotId: input.expectedSnapshotId,
      expectedPaths: [...input.expectedPaths],
    });
    const png = await page.locator('[data-airp-canvas-surface]').screenshot({ type: 'png' });
    const dimensions = pngDimensions(png);
    if (!dimensions || dimensions.width !== input.viewport.width || dimensions.height !== input.viewport.height) {
      throw new CanvasBrowserError('internal', 'screenshot_canvas failed: the canvas screenshot dimensions were not the requested viewport.');
    }
    return { png, dimensions, evidence };
  } catch (error) {
    if (error instanceof CanvasBrowserError) throw error;
    if (signal.aborted) throw abortError(false);
    const timeoutMessage =
      error instanceof Error && /timeout|timed out/i.test(error.message)
        ? `screenshot_canvas failed: the canvas did not become ready within ${Math.round(timeout / 1000)}s.`
        : null;
    const message = timeoutMessage ??
      (error instanceof Error && error.message === 'canvas-identity-mismatch'
        ? 'screenshot_canvas failed: the canvas page did not expose the requested layer and snapshot.'
        : error instanceof Error && error.message === 'canvas-error'
          ? 'screenshot_canvas failed: the canvas page reported a rendering error.'
          : error instanceof Error && error.message === 'canvas-geometry-mismatch'
            ? 'screenshot_canvas failed: the canvas DOM geometry did not match the snapshot.'
            : `screenshot_canvas failed: ${error instanceof Error ? error.message : 'the browser could not capture the canvas.'}`);
    throw new CanvasBrowserError('internal', message);
  } finally {
    await page?.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/** Test/process shutdown seam. It closes the shared browser when available. */
export async function closeCanvasBrowser(): Promise<void> {
  const browser = await browserPromise?.catch(() => undefined);
  browserPromise = null;
  const closable = browser as (Browser & { close?: () => Promise<void> }) | undefined;
  await closable?.close?.().catch(() => {});
}
