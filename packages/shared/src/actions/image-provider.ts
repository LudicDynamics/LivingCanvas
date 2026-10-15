/**
 * The image-generation port (doc 11 §4.3.2). Zero dependencies: no pi-rp, no
 * store, no node built-ins. The action layer knows nothing about any provider
 * implementation; the extension shell registers one factory at load time.
 *
 * Why a process-level service locator and NOT an `ActionContext` field: 01 froze
 * the `ActionContext` field set as exactly `{ store, actor, turn, now?, rng? }`
 * and explicitly refuses new fields (doc 11 §11 conflict 7). A module-level
 * registry is the smallest alternative; it is OPTIONAL by construction — with
 * no factory registered `resolveImageProvider()` returns `null` and the action
 * fails loud with `unsupported`, it never pretends success.
 */

/** A resolved image-generation port. */
export interface ImageProvider {
  /** For `details.provider`, e.g. 'openrouter'. */
  readonly id: string;
  /** The model id actually used. */
  readonly model: string;
  /** True when the model's `input` capability contains `image` (doc 11 §2.1). */
  readonly supportsReference: boolean;
  generate(
    req: { prompt: string; width: number; height: number; reference?: { dataB64: string; mimeType: string } },
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
      /**
       * 'in-progress' when the image is drawn mid-scene (a writer / character
       * tool call). The hosted gateway may then degrade a wallet-short request
       * to one cheap image instead of refusing it (`X-Worldlines-Scene`).
       */
      scene?: 'in-progress';
    }
  ): Promise<
    | { ok: true; mimeType: string; dataB64: string }
    | { ok: false; reason: ImageFailureReason; message: string }
  >;
}

/**
 * The seven failure reasons a provider may report (doc 11 §5 conflict 5). All of
 * them map onto the frozen `ActionErrorCode` set inside the action module; this
 * union only exists to carry the precise cause into `details.reason` and the
 * message.
 */
export type ImageFailureReason =
  | 'no_provider'
  | 'no_credentials'
  | 'provider_error'
  | 'timeout'
  | 'aborted'
  | 'policy'
  | 'no_image';

/** The single registered factory; `null` means "no image model configured". */
let providerFactory: (() => ImageProvider | null) | null = null;

/**
 * Called once by the extension shell (doc 11 §8.4) at module load. Idempotent by
 * convention: a second call replaces the first factory.
 */
export function registerImageProviderFactory(factory: () => ImageProvider | null): void {
  providerFactory = factory;
}

/**
 * Ask the factory for a provider. `reason` is `'no_provider'` whenever no
 * provider could be built — the only reason this function can report; the other
 * six reasons are produced by `ImageProvider.generate` itself.
 */
export function resolveImageProvider(): { provider: ImageProvider | null; reason: ImageFailureReason | null } {
  const provider = providerFactory ? providerFactory() : null;
  if (!provider) return { provider: null, reason: 'no_provider' };
  return { provider, reason: null };
}

/** Test seam: drop the process-level registration between worlds (doc 11 §10.2). */
export function resetImageProviderForTests(): void {
  providerFactory = null;
}
