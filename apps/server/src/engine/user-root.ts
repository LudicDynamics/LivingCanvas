import path from 'node:path';

/**
 * Per-user save roots.
 *
 * The AIRP server holds ONE active world per process, so a hosted player gets a
 * whole container (`deploy/vps/`). The container is told WHOSE container it is
 * through `AIRP_USER_ID`, set by the seat gateway after it verified the
 * Supabase session — the server never parses a token and never trusts a request
 * header, because a header is attacker-controlled and an env var is not.
 *
 * Everything downstream keeps the old shape: the client still sees save ids of
 * the form `worlds/<id>`, the local developer (no env) still reads and writes
 * `<repo>/worlds`, and only the DIRECTORY those ids resolve into moves.
 */

/** `AIRP_USER_ID` when it is a safe single path segment, else `local`. */
const USER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function userId(): string {
  const raw = (process.env.AIRP_USER_ID ?? '').trim();
  return USER_ID.test(raw) ? raw : 'local';
}

/**
 * The directory saves live in.
 *
 * `AIRP_WORLDS_ROOT` wins when set (the container mounts a shared volume);
 * otherwise `local` keeps today's `<repo>/worlds` byte for byte, and a real
 * user gets `<repo>/worlds/users/<uid>`. The `users/` segment is why a uid may
 * never contain a separator: `USER_ID` above is the only guard between the
 * gateway's claim and the filesystem.
 */
export function worldsRoot(repoRoot: string): string {
  const declared = (process.env.AIRP_WORLDS_ROOT ?? '').trim();
  if (declared) return path.resolve(declared);
  const uid = userId();
  return uid === 'local' ? path.join(repoRoot, 'worlds') : path.join(repoRoot, 'worlds', 'users', uid);
}

/** A uid that may name a tenant directory: the same one-segment rule as `userId()`. */
export function isTenantId(uid: unknown): uid is string {
  return typeof uid === 'string' && USER_ID.test(uid);
}

/**
 * The save root of ANY user, not just the one this process serves
 *. A hosted seat serves one user; the sync
 * service serves every signed-in account the gateway vouches for, so it needs
 * the root of that account.
 *
 * `AIRP_TENANTS_ROOT` (the sync container: `/data/users`) gives
 * `<root>/<uid>/worlds` — the same directory the seat of that user gets as
 * `AIRP_WORLDS_ROOT`, so a draft uploaded here is on that user's hosted shelf
 * and a draft made on the hosted shelf is in their tenant. Without it, the
 * current user keeps `worldsRoot` and anyone else resolves the way
 * `worldsRoot` would for them (`<repo>/worlds/users/<uid>`).
 */
export function tenantWorldsRoot(repoRoot: string, uid: string): string {
  if (!isTenantId(uid)) throw new Error('Invalid tenant id.');
  const declared = (process.env.AIRP_TENANTS_ROOT ?? '').trim();
  if (declared) return path.join(path.resolve(declared), uid, 'worlds');
  if (uid === userId()) return worldsRoot(repoRoot);
  return uid === 'local' ? path.join(repoRoot, 'worlds') : path.join(repoRoot, 'worlds', 'users', uid);
}

/**
 * A client-facing world path → an absolute directory.
 *
 * Three shapes reach this: `worlds/<id>` (a save — resolves inside the CURRENT
 * user's root, which is what makes two users with the same save id different
 * directories), `templates/<id>` (shared, read-only, never per-user), and an
 * absolute path (the boot world and tests). A `worlds/` path is taken apart and
 * rebuilt rather than joined verbatim, so a stale absolute path baked into an
 * old client cannot reach another user's directory.
 */
export function resolveWorldPath(repoRoot: string, worldPath: string): string {
  if (path.isAbsolute(worldPath)) return worldPath;
  const segments = worldPath.split('/').filter(Boolean);
  if (segments[0] === 'worlds' && segments.length > 1) {
    return path.join(worldsRoot(repoRoot), ...segments.slice(1));
  }
  // `published/<id>` is a world another player (or this one) published from
  // the workshop: shared and read-only like a template, played as a copy.
  if (segments[0] === 'published' && segments.length > 1) {
    return path.join(publishedRoot(repoRoot), ...segments.slice(1));
  }
  return path.join(repoRoot, worldPath);
}

/**
 * Where published workshop worlds live.
 *
 * One directory shared by EVERY user of a deployment, unlike `worldsRoot`: a
 * published world is exactly the thing other people are meant to see. The
 * container sets `AIRP_PUBLISHED_ROOT` to a shared volume; a local developer
 * gets `<repo>/worlds/published`, which the `worlds/` gitignore rule already
 * keeps out of the repo.
 */
export function publishedRoot(repoRoot: string): string {
  const declared = (process.env.AIRP_PUBLISHED_ROOT ?? '').trim();
  if (declared) return path.resolve(declared);
  return path.join(repoRoot, 'worlds', 'published');
}

/**
 * An absolute save directory → the `worlds/<id>` the client keeps using.
 *
 * Outside the user's root (a template, an absolute `AIRP_WORLD`) it falls back
 * to the repo-relative path, which is what the shelf showed before accounts
 * existed.
 */
export function relativeSavePath(repoRoot: string, absolute: string): string {
  const root = worldsRoot(repoRoot);
  const inside = path.relative(root, absolute);
  if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) {
    return `worlds/${inside.split(path.sep).join('/')}`;
  }
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}
