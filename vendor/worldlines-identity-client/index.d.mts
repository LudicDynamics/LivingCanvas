// Type declarations for @worldlines/identity-client (index.mjs).

export interface WorldlinesClaims {
	iss: string;
	aud: string | string[];
	sub: string;
	email: string | null;
	role: string;
	plan: string;
	anon: boolean;
	sid: string;
	iat: number;
	nbf: number;
	exp: number;
	jti: string;
	[k: string]: unknown;
}

export interface WorldlinesUser {
	id: string;
	email: string | null;
	role: string;
	plan: string;
	anonymous: boolean;
	sessionId: string | null;
	isAdmin: boolean;
}

export interface Verifier {
	verify(token: string | null | undefined): Promise<WorldlinesClaims | null>;
	verifySync(token: string | null | undefined): WorldlinesClaims | null;
	prime(token: string): Promise<void>;
	refresh(opts?: { force?: boolean }): Promise<boolean>;
	hasKey(kid: string): boolean;
	readonly keyCount: number;
}

export function createVerifier(opts: {
	issuer: string;
	audience?: string;
	jwksUrl?: string;
	jwks?: { keys: object[] } | null;
	fetchImpl?: typeof fetch;
	now?: () => number;
	ttlMs?: number;
	minRefreshMs?: number;
	leewaySec?: number;
	logger?: { warn(...a: unknown[]): void } | null;
}): Verifier;

export function toUser(claims: WorldlinesClaims | null): WorldlinesUser | null;

export interface IntrospectionResult {
	active: boolean;
	token_type?: "pat";
	sub?: string;
	email?: string | null;
	role?: string;
	plan?: string;
	scope?: string;
	scopes?: string[];
	pat_id?: string;
	exp?: number | null;
	iss?: string;
}

export interface Introspector {
	introspect(token: string): Promise<IntrospectionResult>;
	invalidate(token: string): boolean;
	clear(): void;
	readonly size: number;
}

export function createIntrospector(opts: {
	issuer: string;
	serviceKey: string;
	fetchImpl?: typeof fetch;
	now?: () => number;
	ttlMs?: number;
	negativeTtlMs?: number;
	maxEntries?: number;
}): Introspector;

export type Authenticated =
	| { kind: "jwt"; user: WorldlinesUser; claims: WorldlinesClaims }
	| { kind: "pat"; user: WorldlinesUser; scopes: string[] };

export function createAuthenticator(deps: { verifier: Verifier; introspector?: Introspector | null }): (
	authorization: string | null | undefined,
	opts?: { requiredScope?: string | null },
) => Promise<Authenticated | null>;

export interface TokensResponse {
	token_type: "Bearer";
	access_token: string;
	expires_in: number;
	refresh_token: string;
	refresh_expires_in: number;
	session_id: string;
	user: { id: string; email: string | null; display_name: string | null; role: string; plan: string; anonymous: boolean };
	/** app sign-ins only (login({ clientId })): the app and the space-separated scopes it was granted */
	client_id?: string;
	scope?: string;
}

export interface StoredSession {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	sessionId: string | null;
	user: TokensResponse["user"] | null;
}

export class IdentityError extends Error {
	status: number;
	code: string;
	/** the JSON error body, when there was one (e.g. { error: "busy", lease_expires_at }) */
	body?: any;
}

export function createPkce(): { verifier: string; challenge: string; method: "S256" };
export function loginUrl(opts: { issuer: string; provider?: string | null; redirect: string; codeChallenge: string; state?: string; clientId?: string | null; scopes?: string[] | null; next?: string | null }): string;
export function exchangeCode(opts: { issuer: string; code: string; codeVerifier: string; redirect?: string; fetchImpl?: typeof fetch }): Promise<TokensResponse>;
export function refreshTokens(opts: { issuer: string; refreshToken: string; fetchImpl?: typeof fetch }): Promise<TokensResponse>;
export function logout(opts: { issuer: string; accessToken?: string; refreshToken?: string; fetchImpl?: typeof fetch }): Promise<{ ok: true }>;
export function sessionFromTokens(t: TokensResponse, now?: number): StoredSession;

export function localLogin(opts: {
	issuer: string;
	provider?: string | null;
	clientId?: string | null;
	scopes?: string[] | null;
	next?: string | null;
	openBrowser?: (url: string) => unknown;
	onUrl?: ((url: string) => void) | null;
	host?: string;
	port?: number;
	path?: string;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
}): Promise<TokensResponse>;

export const DEVICE_GRANT: "urn:ietf:params:oauth:grant-type:device_code";
export interface DeviceCodeDisplay { user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number }
export function canOpenBrowser(env?: Record<string, string | undefined>, platform?: string): boolean;
export function openSystemBrowser(url: string): void;
/** Device code flow (RFC 8628). */
export function deviceLogin(opts: {
	issuer: string;
	clientId: string;
	scopes?: string[] | null;
	next?: string | null;
	onCode?: ((c: DeviceCodeDisplay) => unknown) | null;
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	signal?: AbortSignal | null;
	now?: () => number;
}): Promise<TokensResponse>;
/** App sign-in like Claude Code / Codex: loopback (browser → consent) or the device flow (device: true / no browser). */
export function login(opts: {
	issuer: string;
	clientId: string;
	scopes?: string[] | null;
	device?: boolean | null;
	next?: string | null;
	tokenManager?: { signIn(tokens: TokensResponse): Promise<void> } | null;
	openBrowser?: ((url: string) => unknown) | null;
	onUrl?: ((url: string) => void) | null;
	onCode?: ((c: DeviceCodeDisplay) => unknown) | null;
	provider?: string | null;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
}): Promise<TokensResponse>;
/** Send the user to billing once when a product service answered with { billing_url }. → the URL, or null. */
export function openBilling(error: { billing_url?: string; body?: { billing_url?: string } } | null | undefined, opts?: { next?: string | null; openBrowser?: ((url: string) => unknown) | null; onUrl?: ((url: string) => void) | null; headless?: boolean | null }): string | null;

export function createTokenManager(opts: {
	issuer: string;
	load: () => Promise<StoredSession | null>;
	save: (s: StoredSession | null) => Promise<void>;
	fetchImpl?: typeof fetch;
	now?: () => number;
	slackMs?: number;
}): {
	accessToken(opts?: { force?: boolean }): Promise<string | null>;
	signIn(tokens: TokensResponse): Promise<void>;
	signOut(): Promise<void>;
};

// ── tenancy (spec §3) ───────────────────────────────────────────────────────

export interface Resource {
	product: string;
	kind: string;
	id: string;
	owner_id: string;
	mine: boolean;
	status: "draft" | "published";
	title: string | null;
	/** product-defined, ≤ 4 KB, public once published — never secrets */
	meta: Record<string, unknown>;
	revision: number;
	/** published: the revision the public gets (fixed at publish time); draft: null */
	published_revision: number | null;
	hash: string | null;
	size: number | null;
	created_at: string;
	updated_at: string;
	committed_at: string | null;
	published_at: string | null;
	/** owner only */
	lease?: { active: true; expires_at: string } | null;
}

export interface ResourceLease {
	leaseId: string;
	expiresAt: number;
	ttlSeconds: number;
}

export interface CommitInput {
	revision?: number;
	hash: string;
	size: number;
	meta?: Record<string, unknown>;
}

export interface ResourcesClient {
	readonly product: string;
	list(opts?: { scope?: "mine" | "public"; kind?: string; limit?: number; cursor?: string }): Promise<{ resources: Resource[]; next_cursor: string | null }>;
	get(kind: string, id: string): Promise<Resource>;
	register(kind: string, opts?: { id?: string; title?: string; meta?: Record<string, unknown> }): Promise<{ created: boolean; resource: Resource }>;
	lease(kind: string, id: string, opts?: { ttlSeconds?: number }): Promise<ResourceLease>;
	commit(kind: string, id: string, opts: CommitInput & { leaseId: string }): Promise<Resource>;
	release(kind: string, id: string, leaseId: string): Promise<true>;
	/** leaseId: publish under your own live lease (released with it); otherwise 409 busy while any lease is live. */
	publish(kind: string, id: string, opts?: { leaseId?: string; revision?: number }): Promise<{ changed: boolean; resource: Resource }>;
	unpublish(kind: string, id: string, opts?: { leaseId?: string }): Promise<{ changed: boolean; resource: Resource }>;
	remove(kind: string, id: string): Promise<true>;
	withLease<T>(
		kind: string,
		id: string,
		fn: (
			lease: ResourceLease & {
				commit(c: CommitInput): Promise<Resource>;
				publish(): Promise<{ changed: boolean; resource: Resource }>;
				unpublish(): Promise<{ changed: boolean; resource: Resource }>;
			},
		) => Promise<T>,
		opts?: { ttlSeconds?: number },
	): Promise<T>;
}

export function createResourcesClient(opts: {
	baseUrl: string;
	getToken: (opts: { force: boolean }) => Promise<string | null> | string | null;
	product: string;
	actingUser?: string | null;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}): ResourcesClient;
