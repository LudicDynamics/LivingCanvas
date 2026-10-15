// Vendored from the Worldlines identity service (see vendor/worldlines-identity-client/VERSION).
// The same relative path resolves from src/sync and dist/sync.
import * as identity from '../../../../vendor/worldlines-identity-client/index.mjs';
import { BundleError } from './bundle.js';

/**
 * Tenancy through the Worldlines identity service (the design notes
 * §租户在身份服务里; the Worldlines identity service the design notes).
 *
 * A LivingCanvas workshop world is the resource `livingcanvas / world /
 * made-xxxxxxxx`. The service is the one source of truth for who owns it,
 * whether it is a draft or published, and who may submit to it right now (a
 * lease; a second one is `409 busy`). The files stay on this container's
 * volumes; the service never sees them.
 *
 * The sync container acts FOR the uid the gateway vouched for, with its own
 * service key (`WL_ID_SERVICE_KEY`, listed in the service's
 * `ID_RESOURCE_SERVICES` as `livingcanvas-sync:livingcanvas`), so ownership is
 * that user's, never the container's.
 *
 * Without `WL_ID_ISSUER` (a local `pnpm dev`) there is no service: tenant.ts
 * keeps its in-process rules. With it configured but not answering, writes
 * FAIL CLOSED (503) — nothing is written without a lease.
 */

export const PRODUCT = 'livingcanvas';
export const KIND = 'world';
/** Seconds an upload / publish may hold its world (the service's maximum). */
export const LEASE_TTL = 900;

export type ResourcesClient = identity.ResourcesClient;
export type Resource = identity.Resource;

/** Is tenancy delegated to the identity service in this process? */
export function resourcesConfigured(): boolean {
  return Boolean((process.env.WL_ID_ISSUER ?? '').trim());
}

/**
 * A resources client acting for `uid`, or null when the service is not
 * configured (fallback mode). One per request: it is only a closure.
 */
export function resourcesFor(uid: string): ResourcesClient | null {
  const issuer = (process.env.WL_ID_ISSUER ?? '').trim();
  if (!issuer) return null;
  const key = (process.env.WL_ID_SERVICE_KEY ?? '').trim();
  if (!key) throw new BundleError(503, 'tenancy_unavailable', 'The remote is misconfigured (no identity service key). Try again later.');
  return identity.createResourcesClient({ baseUrl: issuer, getToken: () => key, product: PRODUCT, actingUser: uid, timeoutMs: 10_000 });
}

export const isIdentityError = (err: unknown, status?: number, code?: string): err is identity.IdentityError =>
  err instanceof identity.IdentityError && (status === undefined || err.status === status) && (code === undefined || err.code === code);

export const BUSY_MESSAGE = 'Another submission for this world is still running. Try again when it has finished.';

/**
 * A service answer → the sync API's own error. The caller's 4xx keep their
 * meaning (busy, not found, not the owner); an outage, a refused service key
 * or anything unexpected is a 503: the remote cannot decide tenancy now.
 */
export function tenancyError(err: unknown, notOwner?: BundleError): unknown {
  if (err instanceof BundleError || !(err instanceof identity.IdentityError)) return err;
  if (err.status === 409 && err.code === 'busy') return new BundleError(409, 'busy', BUSY_MESSAGE);
  if (err.status === 404) return new BundleError(404, 'not_found', 'No such world in the remote.');
  if (err.status === 403 && err.code === 'not_owner') return notOwner ?? new BundleError(403, 'not_owner', 'Only the author can change this world.');
  if (err.status === 403 && err.code === 'unknown_user') return new BundleError(403, 'unknown_user', 'Sign in to your Worldlines account once on the web, then try again.');
  if (err.status === 409 && err.code === 'lease_invalid') return new BundleError(409, 'busy', 'This submission took too long and lost its turn. Try again.');
  if (err.status === 429) return new BundleError(429, 'rate_limited', 'Too many requests to the account service. Try again shortly.');
  console.warn(`[Sync] identity service: ${err.status} ${err.code}${err.message ? ` — ${err.message}` : ''}`);
  return new BundleError(503, 'tenancy_unavailable', 'The remote cannot check world ownership right now. Try again later.');
}

/** Run a service call, translating its errors. */
export async function tenancy<T>(run: () => Promise<T>, notOwner?: BundleError): Promise<T> {
  try { return await run(); } catch (err) { throw tenancyError(err, notOwner); }
}

/** Every resource of one scope (the service pages at ≤ 100). */
export async function listAll(client: ResourcesClient, scope: 'mine' | 'public'): Promise<Resource[]> {
  const out: Resource[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const r = await client.list({ scope, kind: KIND, limit: 100, ...(cursor ? { cursor } : {}) });
    out.push(...r.resources);
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return out;
}

/** The resource, or null when the service has no record the caller may see (404). */
export async function getOrNull(client: ResourcesClient, id: string): Promise<Resource | null> {
  try { return await client.get(KIND, id); } catch (err) { if (isIdentityError(err, 404)) return null; throw err; }
}

/**
 * Register on first sight (worlds that predate the service): `client` must act
 * for the world's owner. → the resource, or null when the id already belongs
 * to someone else (409 owned — that copy gets a new id on its next upload).
 * A PUBLIC world is published right after, so the record matches the files.
 */
export async function registerOnFirstSight(client: ResourcesClient, id: string, opts: { title?: string; published?: boolean } = {}): Promise<Resource | null> {
  let resource: Resource;
  try {
    resource = (await client.register(KIND, { id, ...(opts.title ? { title: opts.title.slice(0, 200) } : {}) })).resource;
  } catch (err) {
    if (isIdentityError(err, 409, 'owned')) return null;
    throw err;
  }
  if (opts.published && resource.status !== 'published') resource = (await client.publish(KIND, id)).resource;
  return resource;
}
