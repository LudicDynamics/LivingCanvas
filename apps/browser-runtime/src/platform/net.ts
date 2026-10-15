// Outbound fetches to origins that send no CORS headers (the identity service,
// the hosted remote) cannot be made from a Worker. The dev host forwards them
// at /api/browser-runtime/net/<target>/… (apps/server/src/routes/browser-runtime.ts);
// this wrapper rewrites only URLs under those allowlisted bases, so the
// server's remote-client runs unmodified. Everything else goes out unchanged.

/** `url` rewritten onto the proxy when it lies under one of `targets` ({ name: base ending in / }), else null. */
export function proxiedUrl(url: string, proxy: string, targets: Record<string, string>): string | null {
  for (const [name, base] of Object.entries(targets)) {
    if (url.startsWith(base)) return `${proxy}/${name}/${url.slice(base.length)}`;
    if (url === base.slice(0, -1)) return `${proxy}/${name}/`;
  }
  return null;
}

export function installNetProxy(proxy: string, targets: Record<string, string>, g: any = globalThis) {
  const direct: typeof fetch = g.fetch.bind(g);
  g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? new URL(input, g.location?.href).href : input instanceof URL ? input.href : input.url;
    const to = proxiedUrl(href, proxy, targets);
    if (!to) return direct(input as any, init);
    // credentials: 'omit' — the host's own cookies never ride along (the proxy strips them too).
    if (typeof input === 'string' || input instanceof URL) return direct(to, { ...init, credentials: 'omit' });
    return direct(new Request(to, input), { ...init, credentials: 'omit' });
  };
}
