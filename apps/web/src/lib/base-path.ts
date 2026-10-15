/// <reference types="vite/client" />
// Serve the app under a URL prefix (e.g. https://host/airp-infini-canvas/ on a
// shared host). Client code and the server both spell root-absolute `/api` and
// `/ws` URLs — including media URLs the server returns in JSON — so the prefix
// is applied once at the browser boundary instead of in every call site.
// Import this module first. With the default base "/" it does nothing.
// `import.meta.env` is Vite's, and it is absent when this module is imported
// outside a Vite build — which node's test runner does as soon as anything in
// the import graph reaches here. Treat that as "no prefix": the tests exercise
// the URL helpers directly, and a bare read would throw at import time and take
// the whole module graph with it.
const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
const ROOTED = /^\/(?:api|ws)(?:[/?#]|$)/;

/** Prefix a root-absolute or same-origin absolute `/api`/`/ws` URL with the base. */
export function withBase(url: string | null | undefined): string {
  if (!url) return '';
  if (!BASE) return url;
  if (ROOTED.test(url)) return BASE + url;
  if (/^(?:https?|wss?):\/\//.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.host === window.location.host && ROOTED.test(parsed.pathname)) {
        parsed.pathname = BASE + parsed.pathname;
        return parsed.toString();
      }
    } catch { /* Not a URL we own. */ }
  }
  return url;
}

/** Wrap an accessor's setter, found on `target` or its prototype chain. */
function wrapSetter(target: object, prop: string, map: (value: string) => string) {
  let owner: object | null = target;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, prop)) owner = Object.getPrototypeOf(owner);
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, prop);
  if (!owner || !descriptor?.set) return;
  const set = descriptor.set;
  Object.defineProperty(owner, prop, { ...descriptor, set(value: unknown) { set.call(this, typeof value === 'string' ? map(value) : value); } });
}

if (BASE) {
  const fetchRoot = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) return fetchRoot(withBase(String(input)), init);
    const url = withBase(input.url);
    return fetchRoot(url === input.url ? input : new Request(url, input), init);
  };

  const RootWebSocket = window.WebSocket;
  window.WebSocket = class extends RootWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(withBase(String(url)), protocols);
    }
  };

  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    const lower = name.toLowerCase();
    setAttribute.call(this, name, lower === 'src' || lower === 'href' || lower === 'poster' ? withBase(String(value)) : value);
  };
  wrapSetter(HTMLImageElement.prototype, 'src', withBase);
  wrapSetter(HTMLMediaElement.prototype, 'src', withBase);
  wrapSetter(HTMLSourceElement.prototype, 'src', withBase);
  wrapSetter(HTMLVideoElement.prototype, 'poster', withBase);
  wrapSetter(HTMLAnchorElement.prototype, 'href', withBase);
  // Inline `backgroundImage: url(…)` styles are not intercepted here; those
  // call sites wrap their URL in `withBase` themselves.
}
