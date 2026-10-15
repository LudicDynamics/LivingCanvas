// @worldlines/identity-client — Node ≥ 22, zero dependencies.
//
// For services that ACCEPT Worldlines credentials:
//   createVerifier({ issuer, audience })      verify access tokens locally via JWKS (cached, kid rotation)
//   createIntrospector({ issuer, serviceKey }) PAT → identity via POST /v1/introspect (cached by token hash)
//   createAuthenticator({ verifier, introspector })  "Authorization: Bearer …" → { kind, user, scopes } | null
// For apps that SIGN USERS IN:
//   createPkce() / loginUrl() / exchangeCode() / refreshTokens() / logout()
//   localLogin({ issuer, openBrowser })       loopback-redirect login for local apps (RFC 8252)
//   login({ issuer, clientId, scopes })       app sign-in like Claude Code / Codex: browser → consent → tokens;
//                                             device code flow when { device: true } or there is no browser
//   deviceLogin({ issuer, clientId, scopes })  the device code flow alone (RFC 8628)
//   openBilling(error, { next })              send the user to billing when ai.worldlines.gg answers with a billing_url
//   createTokenManager({ issuer, load, save }) keep a session fresh (single-flight refresh)
// For products that store tenant content (tenancy, spec §3):
//   createResourcesClient({ baseUrl, getToken, product }) register / lease / commit / publish; withLease

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const trimSlash = (u) => String(u ?? "").replace(/\/+$/, "");

// ── JWT verification ────────────────────────────────────────────────────────

function decode(token) {
	if (typeof token !== "string" || token.length > 8192) return null;
	const parts = token.split(".");
	if (parts.length !== 3 || parts.some((p) => !p)) return null;
	try {
		const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
		return { header, payload, input: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") };
	} catch {
		return null;
	}
}

/**
 * Local verifier for Worldlines access tokens (ES256 only; the key decides the
 * algorithm, never the token). Checks signature, iss, aud, exp, nbf, sub.
 *
 * @param {{
 *   issuer: string, audience?: string, jwksUrl?: string, jwks?: { keys: object[] },
 *   fetchImpl?: typeof fetch, now?: () => number, ttlMs?: number, minRefreshMs?: number,
 *   leewaySec?: number, logger?: { warn(...a: any[]): void } | null,
 * }} opts  `jwks` = static key set (no fetching; used by the identity service itself and tests)
 */
export function createVerifier({
	issuer,
	audience = "worldlines",
	jwksUrl,
	jwks = null,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	ttlMs = 10 * 60_000,
	minRefreshMs = 30_000,
	leewaySec = 30,
	logger = console,
} = {}) {
	if (!issuer) throw new Error("createVerifier: issuer is required");
	const iss = trimSlash(issuer);
	const url = jwks ? null : jwksUrl || `${iss}/.well-known/jwks.json`;
	const keys = new Map();
	let fetchedAt = 0;
	let attemptAt = -Infinity;
	let inflight = null;

	function load(set) {
		const next = new Map();
		for (const jwk of Array.isArray(set?.keys) ? set.keys : []) {
			if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.kid !== "string") continue;
			if (jwk.alg && jwk.alg !== "ES256") continue;
			try {
				next.set(jwk.kid, createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" }));
			} catch {
				/* skip malformed key */
			}
		}
		return next;
	}
	if (jwks) for (const [k, v] of load(jwks)) keys.set(k, v);

	async function refresh({ force = false } = {}) {
		if (!url) return false;
		if (inflight) return inflight;
		if (!force && now() - attemptAt < minRefreshMs) return false;
		attemptAt = now();
		inflight = (async () => {
			try {
				const res = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000) });
				if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
				const next = load(await res.json());
				if (next.size === 0) throw new Error("JWKS has no usable keys");
				keys.clear();
				for (const [k, v] of next) keys.set(k, v);
				fetchedAt = now();
				return true;
			} catch (err) {
				logger?.warn?.(`[worldlines-identity] JWKS fetch failed, keeping ${keys.size} cached key(s): ${err?.message ?? err}`);
				return false;
			} finally {
				inflight = null;
			}
		})();
		return inflight;
	}

	function checkClaims(p) {
		const t = Math.floor(now() / 1000);
		if (typeof p.sub !== "string" || !p.sub) return false;
		if (p.iss !== iss) return false;
		const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
		if (!aud.includes(audience)) return false;
		if (typeof p.exp !== "number" || p.exp + leewaySec <= t) return false;
		if (typeof p.nbf === "number" && p.nbf - leewaySec > t) return false;
		return true;
	}

	/** Synchronous: cached keys only. Unknown kid → null (and a background refresh). */
	function verifySync(token) {
		const d = decode(token);
		if (!d || d.header.alg !== "ES256" || typeof d.header.kid !== "string") return null;
		if (url && fetchedAt && now() - fetchedAt > ttlMs) void refresh();
		const key = keys.get(d.header.kid);
		if (!key) {
			void refresh();
			return null;
		}
		let ok = false;
		try {
			ok = cryptoVerify("sha256", Buffer.from(d.input), { key, dsaEncoding: "ieee-p1363" }, d.signature);
		} catch {
			ok = false;
		}
		if (!ok || !checkClaims(d.payload)) return null;
		return d.payload;
	}

	/** Make sure the token's kid is known (fetches JWKS at most every minRefreshMs). */
	async function prime(token) {
		const d = decode(token);
		if (!url || !d || typeof d.header.kid !== "string" || keys.has(d.header.kid)) return;
		await refresh({ force: keys.size === 0 });
	}

	return {
		/** → claims | null. Never throws. */
		async verify(token) {
			await prime(token);
			return verifySync(token);
		},
		verifySync,
		prime,
		refresh,
		hasKey: (kid) => keys.has(kid),
		get keyCount() {
			return keys.size;
		},
	};
}

/** Verified claims → the user shape every service sees. */
export function toUser(claims) {
	if (!claims) return null;
	return {
		id: claims.sub,
		email: claims.email ?? null,
		role: claims.role ?? "user",
		plan: claims.plan ?? "free",
		anonymous: claims.anon === true,
		sessionId: claims.sid ?? null,
		isAdmin: claims.role === "platform_admin",
	};
}

// ── PAT introspection ───────────────────────────────────────────────────────

/**
 * PAT → identity via the identity service, cached by SHA-256(token) so the raw
 * token is never a map key. Positive answers are cached ttlMs (a revoked PAT
 * keeps working at most that long), negative ones negativeTtlMs.
 */
export function createIntrospector({
	issuer,
	serviceKey,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	ttlMs = 60_000,
	negativeTtlMs = 10_000,
	maxEntries = 10_000,
} = {}) {
	if (!issuer || !serviceKey) throw new Error("createIntrospector: issuer and serviceKey are required");
	const endpoint = `${trimSlash(issuer)}/v1/introspect`;
	const cache = new Map();
	const inflight = new Map();
	const keyOf = (token) => createHash("sha256").update(token).digest("hex");

	async function introspect(token) {
		if (typeof token !== "string" || !token.startsWith("wl_pat_") || token.length > 200) return { active: false };
		const k = keyOf(token);
		const hit = cache.get(k);
		if (hit && hit.until > now()) {
			if (hit.value.active && hit.value.exp && hit.value.exp * 1000 <= now()) return { active: false };
			return hit.value;
		}
		if (inflight.has(k)) return inflight.get(k);
		const p = (async () => {
			const res = await fetchImpl(endpoint, {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(8000),
				headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify({ token }),
			});
			if (!res.ok) throw new Error(`introspect HTTP ${res.status}`); // not cached: an outage is not a "no"
			const value = await res.json();
			if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
			cache.set(k, { value, until: now() + (value.active ? ttlMs : negativeTtlMs) });
			return value;
		})().finally(() => inflight.delete(k));
		inflight.set(k, p);
		return p;
	}

	return {
		introspect,
		invalidate: (token) => cache.delete(keyOf(token)),
		clear: () => cache.clear(),
		get size() {
			return cache.size;
		},
	};
}

/**
 * One call for a request's Authorization header.
 * → { kind: 'jwt', user, claims } | { kind: 'pat', user, scopes } | null
 * `requiredScope` applies to PATs only (a session JWT carries the user's full rights).
 */
export function createAuthenticator({ verifier, introspector = null }) {
	return async function authenticate(authorization, { requiredScope = null } = {}) {
		const m = /^Bearer\s+(\S+)$/i.exec(String(authorization ?? "").trim());
		if (!m) return null;
		const token = m[1];
		if (token.startsWith("wl_pat_")) {
			if (!introspector) return null;
			const r = await introspector.introspect(token);
			if (!r?.active) return null;
			const scopes = Array.isArray(r.scopes) ? r.scopes : String(r.scope ?? "").split(" ").filter(Boolean);
			if (requiredScope && !scopes.includes(requiredScope)) return null;
			return { kind: "pat", scopes, user: { id: r.sub, email: r.email ?? null, role: r.role ?? "user", plan: r.plan ?? "free", anonymous: false, sessionId: null, isAdmin: r.role === "platform_admin" } };
		}
		const claims = await verifier.verify(token);
		return claims ? { kind: "jwt", claims, user: toUser(claims) } : null;
	};
}

// ── signing users in ────────────────────────────────────────────────────────

export function createPkce() {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), method: "S256" };
}

/** URL of /v1/login/start. `redirect` must be on the service's allowlist (or loopback) —
 * or, with `clientId`, on that client's redirect policy. With clientId and no provider,
 * the service shows a provider-choice page. */
export function loginUrl({ issuer, provider = "google", redirect, codeChallenge, state, clientId = null, scopes = null, next = null }) {
	const u = new URL(`${trimSlash(issuer)}/v1/login/start`);
	if (clientId) u.searchParams.set("client_id", clientId);
	if (clientId && scopes?.length) u.searchParams.set("scope", scopes.join(" "));
	if (clientId && next) u.searchParams.set("next", next);
	if (provider) u.searchParams.set("provider", provider);
	u.searchParams.set("redirect", redirect);
	u.searchParams.set("code_challenge", codeChallenge);
	u.searchParams.set("code_challenge_method", "S256");
	if (state) u.searchParams.set("state", state);
	return u.toString();
}

export class IdentityError extends Error {
	constructor(status, code, message) {
		super(message || code);
		this.status = status;
		this.code = code;
	}
}

async function post(fetchImpl, url, body, headers = {}) {
	let res;
	try {
		res = await fetchImpl(url, {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
			headers: { "content-type": "application/json", accept: "application/json", ...headers },
			body: JSON.stringify(body),
		});
	} catch (err) {
		throw new IdentityError(0, "unreachable", `identity service unreachable (${err?.name ?? "error"})`);
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new IdentityError(res.status, data?.error ?? `http_${res.status}`, data?.message);
	return data;
}

/** One-time code (from the redirect) + PKCE verifier → tokens. */
export function exchangeCode({ issuer, code, codeVerifier, redirect, fetchImpl = globalThis.fetch }) {
	return post(fetchImpl, `${trimSlash(issuer)}/v1/token`, { grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: redirect });
}
/** Refresh (rotating: the old refresh token is dead after this call). */
export function refreshTokens({ issuer, refreshToken, fetchImpl = globalThis.fetch }) {
	return post(fetchImpl, `${trimSlash(issuer)}/v1/token/refresh`, { refresh_token: refreshToken });
}
export function logout({ issuer, accessToken, refreshToken, fetchImpl = globalThis.fetch }) {
	return post(fetchImpl, `${trimSlash(issuer)}/v1/logout`, refreshToken ? { refresh_token: refreshToken } : {}, accessToken ? { authorization: `Bearer ${accessToken}` } : {});
}

/** tokens response → a storable session (absolute expiry times). */
export function sessionFromTokens(t, now = Date.now()) {
	return {
		accessToken: t.access_token,
		refreshToken: t.refresh_token,
		expiresAt: now + t.expires_in * 1000,
		sessionId: t.session_id ?? null,
		user: t.user ?? null,
	};
}

const DONE_PAGE = (ok) =>
	`<!doctype html><meta charset="utf-8"><title>Worldlines</title><body style="font:16px system-ui;text-align:center;padding-top:20vh">${ok ? "Signed in. You can close this tab. / 登录完成，可以关闭此页。" : "Sign-in failed. Please try again. / 登录失败，请重试。"}</body>`;

/**
 * Loopback login for local apps: listen on 127.0.0.1:<port>, open the browser at
 * /v1/login/start with redirect=http://127.0.0.1:<port><path>, wait for ?code, exchange it.
 * → Promise<tokens response>. The server closes after one callback or on timeout.
 */
export function localLogin({
	issuer,
	provider,
	clientId = null,
	scopes = null,
	next = null,
	openBrowser,
	host = "127.0.0.1",
	port = 0,
	path = "/callback",
	timeoutMs = 5 * 60_000,
	fetchImpl = globalThis.fetch,
	onUrl = null,
}) {
	if (typeof openBrowser !== "function" && typeof onUrl !== "function") throw new Error("localLogin: pass openBrowser(url) or onUrl(url)");
	if (provider === undefined) provider = clientId ? null : "google"; // app sign-in: let the user pick on auth
	const pkce = createPkce();
	const state = randomBytes(16).toString("base64url");
	return new Promise((resolve, reject) => {
		let redirect;
		let settled = false;
		const server = createServer(async (req, res) => {
			const u = new URL(req.url ?? "/", `http://${host}`);
			if (u.pathname !== path) {
				res.writeHead(404).end();
				return;
			}
			const finish = (ok, err, value) => {
				// `next` was checked by the identity service (billing or this app's own redirect policy)
				const nextUrl = ok ? u.searchParams.get("next") : null;
				if (nextUrl && /^https?:\/\//.test(nextUrl)) res.writeHead(302, { location: nextUrl, "cache-control": "no-store" }).end();
				else res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(DONE_PAGE(ok));
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				server.close();
				ok ? resolve(value) : reject(err);
			};
			if (u.searchParams.get("state") !== state) return finish(false, new IdentityError(400, "state_mismatch"));
			const code = u.searchParams.get("code");
			if (!code) return finish(false, new IdentityError(400, u.searchParams.get("error") || "no_code"));
			try {
				finish(true, null, await exchangeCode({ issuer, code, codeVerifier: pkce.verifier, redirect, fetchImpl }));
			} catch (err) {
				finish(false, err);
			}
		});
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			server.close();
			reject(new IdentityError(408, "login_timeout"));
		}, timeoutMs);
		timer.unref?.();
		server.on("error", (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(err);
			}
		});
		server.listen(port, host, () => {
			redirect = `http://${host}:${server.address().port}${path}`;
			const url = loginUrl({ issuer, provider, redirect, codeChallenge: pkce.challenge, state, clientId, scopes, next });
			onUrl?.(url);
			if (openBrowser) Promise.resolve(openBrowser(url)).catch(() => {});
		});
	});
}

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** Is there (probably) a browser to open? No over SSH, nor on Linux without a display. */
export function canOpenBrowser(env = process.env, platform = process.platform) {
	if (env.SSH_CONNECTION || env.SSH_TTY) return false;
	if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
	return true;
}
/** Open a URL in the system browser (open / xdg-open / start). Never throws. */
export function openSystemBrowser(url) {
	const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
	try {
		spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
	} catch {
		/* a manual copy of the printed URL still works */
	}
}
const printErr = (line) => process.stderr.write(`${line}\n`);

/**
 * Device code flow (RFC 8628): get a code, show "open <url> and enter ABCD-EFGH", poll /v1/token.
 * `onCode({ user_code, verification_uri, verification_uri_complete, expires_in })` shows it (default: stderr).
 * → Promise<tokens response>. Honours interval / slow_down; stops at expires_in or `signal`.
 */
export async function deviceLogin({ issuer, clientId, scopes = null, next = null, onCode = null, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), signal = null, now = () => Date.now() }) {
	if (!clientId) throw new Error("deviceLogin: clientId is required");
	const base = trimSlash(issuer);
	const code = await post(fetchImpl, `${base}/v1/device/code`, { client_id: clientId, ...(scopes?.length ? { scope: scopes.join(" ") } : {}), ...(next ? { next } : {}) });
	const show = { user_code: code.user_code, verification_uri: code.verification_uri, verification_uri_complete: code.verification_uri_complete, expires_in: code.expires_in };
	if (onCode) await onCode(show);
	else printErr(`To sign in, open ${code.verification_uri} and enter the code ${code.user_code}\n  (or open ${code.verification_uri_complete})`);
	const deadline = now() + code.expires_in * 1000;
	let interval = Math.max(1, Number(code.interval) || 5);
	for (;;) {
		await sleep(interval * 1000);
		if (signal?.aborted) throw new IdentityError(499, "aborted");
		if (now() > deadline) throw new IdentityError(400, "expired_token");
		try {
			return await post(fetchImpl, `${base}/v1/token`, { grant_type: DEVICE_GRANT, device_code: code.device_code, client_id: clientId });
		} catch (err) {
			if (!(err instanceof IdentityError)) throw err;
			if (err.code === "authorization_pending" || err.code === "unreachable") continue;
			if (err.code === "slow_down") {
				interval += 5;
				continue;
			}
			throw err; // access_denied | expired_token | invalid_grant | …
		}
	}
}

/**
 * App sign-in like Claude Code / Codex. Loopback (system browser → auth.worldlines.gg → consent →
 * back to 127.0.0.1) by default; the device code flow when `device: true` or there is no browser.
 * With `tokenManager` (createTokenManager) the tokens go straight into it (auto-renewing).
 * → Promise<tokens response> (also carries client_id + scope).
 */
export async function login({ issuer, clientId, scopes = null, device = null, next = null, tokenManager = null, openBrowser = null, onUrl = null, onCode = null, provider, fetchImpl = globalThis.fetch, timeoutMs, sleep }) {
	if (!issuer || !clientId) throw new Error("login: issuer and clientId are required");
	const useDevice = device ?? !(openBrowser || canOpenBrowser());
	const tokens = useDevice
		? await deviceLogin({ issuer, clientId, scopes, next, onCode, fetchImpl, sleep })
		: await localLogin({
				issuer,
				clientId,
				scopes,
				next,
				provider,
				fetchImpl,
				...(timeoutMs ? { timeoutMs } : {}),
				openBrowser: openBrowser ?? openSystemBrowser,
				onUrl: onUrl ?? ((url) => printErr(`Opening your browser to sign in. If it does not open, visit:\n  ${url}`)),
			});
	if (tokenManager) await tokenManager.signIn(tokens);
	return tokens;
}

/**
 * ai.worldlines.gg (and other product services) answer "no subscription / quota used up" with a body
 * carrying `billing_url` (e.g. 429 quota_exceeded). This sends the user there once — no retry loop:
 * opens the system browser (or only prints the URL when headless) at billing_url + next=<your return>.
 * `error` = that response body, or an error with `.body`. → the URL shown, or null when there was none.
 */
export function openBilling(error, { next = null, openBrowser = null, onUrl = null, headless = null } = {}) {
	const raw = error?.billing_url ?? error?.body?.billing_url ?? null;
	if (typeof raw !== "string") return null;
	let u;
	try {
		u = new URL(raw);
	} catch {
		return null;
	}
	if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname))) return null;
	if (next) u.searchParams.set("next", next);
	const url = u.toString();
	const noBrowser = headless ?? !(openBrowser || canOpenBrowser());
	(onUrl ?? ((x) => printErr(noBrowser ? `Open this page to manage your plan: ${x}` : `Opening billing: ${x}`)))(url);
	if (!noBrowser) (openBrowser ?? openSystemBrowser)(url);
	return url;
}

/**
 * Keep one session fresh. `load()` / `save(session|null)` persist it (e.g. a 0600 file).
 * Refreshes are single-flight: rotating refresh tokens mean two parallel refreshes
 * with the same token would look like replay and revoke the session.
 */
export function createTokenManager({ issuer, load, save, fetchImpl = globalThis.fetch, now = () => Date.now(), slackMs = 60_000 }) {
	let refreshing = null;
	async function doRefresh(current) {
		if (!refreshing) {
			refreshing = (async () => {
				try {
					const next = sessionFromTokens(await refreshTokens({ issuer, refreshToken: current.refreshToken, fetchImpl }), now());
					await save(next);
					return next;
				} catch (err) {
					if (err instanceof IdentityError && err.status >= 400 && err.status < 500) await save(null); // dead session: sign in again
					throw err;
				}
			})().finally(() => {
				refreshing = null;
			});
		}
		return refreshing;
	}
	return {
		/** A valid access token (refreshing first when near expiry), or null when signed out. */
		async accessToken({ force = false } = {}) {
			const s = await load();
			if (!s) return null;
			if (!force && s.expiresAt - slackMs > now()) return s.accessToken;
			return (await doRefresh(s)).accessToken;
		},
		async signIn(tokens) {
			await save(sessionFromTokens(tokens, now()));
		},
		async signOut() {
			const s = await load();
			if (s) await logout({ issuer, accessToken: s.accessToken, refreshToken: s.refreshToken, fetchImpl }).catch(() => {});
			await save(null);
		},
	};
}

// ── tenancy (spec §3) ───────────────────────────────────────────────────────

/**
 * Client for /v1/resources, bound to one product (e.g. "livingcanvas"); every
 * method takes the resource `kind` ("world", "worldbook", "card" …) and id.
 * `getToken({ force })` returns the Bearer to send: a user's access token
 * (e.g. createTokenManager().accessToken), a wl_pat_ with resources:* scopes,
 * or a product backend's service key together with `actingUser` (the user's
 * uid → X-Worldlines-User). A 401 is retried once with getToken({ force: true }).
 * Errors throw IdentityError { status, code, body } — e.g. 409 busy / owned /
 * lease_invalid / revision_conflict, 403 not_owner, 404 not_found.
 */
export function createResourcesClient({ baseUrl, getToken, product, actingUser = null, fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
	if (!baseUrl || typeof getToken !== "function" || !product) throw new Error("createResourcesClient: baseUrl, getToken and product are required");
	const base = trimSlash(baseUrl);
	const path = (kind, id, rest = "") => `/v1/resources/${encodeURIComponent(product)}/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${rest}`;

	async function call(method, p, body, retried = false) {
		const token = await getToken({ force: retried });
		if (!token) throw new IdentityError(401, "signed_out", "No Worldlines credential available.");
		let res;
		try {
			res = await fetchImpl(`${base}${p}`, {
				method,
				redirect: "error",
				signal: AbortSignal.timeout(timeoutMs),
				headers: {
					accept: "application/json",
					authorization: `Bearer ${token}`,
					...(actingUser ? { "x-worldlines-user": String(actingUser) } : {}),
					...(body ? { "content-type": "application/json" } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
			});
		} catch (err) {
			throw new IdentityError(0, "unreachable", `identity service unreachable (${err?.name ?? "error"})`);
		}
		const data = await res.json().catch(() => null);
		if (res.status === 401 && !retried && !actingUser) return call(method, p, body, true);
		if (!res.ok) {
			const e = new IdentityError(res.status, data?.error ?? `http_${res.status}`, data?.message);
			e.body = data;
			throw e;
		}
		return data;
	}

	const client = {
		product,
		/** → { resources, next_cursor } (this product only) */
		list({ scope = "mine", kind, limit, cursor } = {}) {
			const q = new URLSearchParams({ scope, product });
			if (kind) q.set("kind", kind);
			if (limit) q.set("limit", String(limit));
			if (cursor) q.set("cursor", cursor);
			return call("GET", `/v1/resources?${q}`);
		},
		async get(kind, id) {
			return (await call("GET", path(kind, id))).resource;
		},
		/** Idempotent for the owner (created:false); 409 owned when the id is someone else's. */
		register(kind, { id, title, meta } = {}) {
			return call("POST", "/v1/resources", { product, kind, id, title, meta });
		},
		/** → { leaseId, expiresAt (ms), ttlSeconds }; 409 busy while another lease is live. */
		async lease(kind, id, { ttlSeconds } = {}) {
			const r = await call("POST", path(kind, id, "/lease"), ttlSeconds ? { ttlSeconds } : {});
			return { leaseId: r.lease_id, expiresAt: Date.parse(r.expires_at), ttlSeconds: r.ttl_seconds };
		},
		/** Records the revision (omitted → current + 1) and releases the lease. → resource */
		async commit(kind, id, { leaseId, revision, hash, size, meta, title }) {
			return (await call("POST", path(kind, id, "/commit"), { leaseId, revision, hash, size, meta, title })).resource;
		},
		async release(kind, id, leaseId) {
			await call("DELETE", path(kind, id, `/lease/${encodeURIComponent(leaseId)}`));
			return true;
		},
		/** leaseId: publish under your own live lease (releasing it); without it, 409 busy while any lease is live.
		 * revision: the (reviewed) revision the public gets (default: current) → resource.published_revision. */
		publish(kind, id, { leaseId, revision } = {}) {
			return call("POST", path(kind, id, "/publish"), { ...(leaseId ? { leaseId } : {}), ...(revision != null ? { revision } : {}) });
		},
		unpublish(kind, id, { leaseId } = {}) {
			return call("POST", path(kind, id, "/unpublish"), leaseId ? { leaseId } : {});
		},
		async remove(kind, id) {
			await call("DELETE", path(kind, id));
			return true;
		},
		/**
		 * lease → fn(lease) → release, always. Inside fn, write the content, then call
		 * `lease.commit({ hash, size, revision?, meta? })` — or, when fn moved the content
		 * between the product's tenant and public areas, `lease.publish()` / `lease.unpublish()`.
		 * Any of these ends the lease; if fn throws (or calls none) the lease is released.
		 */
		async withLease(kind, id, fn, { ttlSeconds } = {}) {
			const l = await client.lease(kind, id, { ttlSeconds });
			let done = false;
			const handle = {
				...l,
				async commit(c) {
					const r = await client.commit(kind, id, { ...c, leaseId: l.leaseId });
					done = true;
					return r;
				},
				async publish() {
					const r = await client.publish(kind, id, { leaseId: l.leaseId });
					done = true;
					return r;
				},
				async unpublish() {
					const r = await client.unpublish(kind, id, { leaseId: l.leaseId });
					done = true;
					return r;
				},
			};
			try {
				return await fn(handle);
			} finally {
				if (!done) await client.release(kind, id, l.leaseId).catch(() => {}); // expired/already gone: nothing to release
			}
		},
	};
	return client;
}
