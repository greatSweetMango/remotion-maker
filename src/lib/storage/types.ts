/**
 * Storage provider abstraction for user uploads (TM-31).
 *
 * Why abstract? Per ADR-PENDING-TM-31, the production storage backend (Vercel
 * Blob / S3) requires credentials that are gated by human approval. The app
 * must remain runnable + testable + UI-buildable without those secrets, so
 * we ship with a `local` provider that no-ops to a placeholder URL and lets
 * us swap in `vercel-blob` once the token is provisioned.
 *
 * All provider implementations MUST:
 *  - validate inputs upstream (caller does MIME + size checks; provider trusts them)
 *  - return a stable `storageKey` we can pass back to `delete`
 *  - return a `url` the browser/Remotion player can fetch directly
 */

export type StorageKind = 'image' | 'font';

export interface StorageObject {
  /** Public URL — served by the provider, browser-fetchable. */
  url: string;
  /** Opaque key used by `delete`. Provider-specific. */
  storageKey: string;
  /** Identifier for the active provider (persisted alongside the asset). */
  provider: string;
}

export interface PutOptions {
  userId: string;
  kind: StorageKind;
  filename: string;
  mimeType: string;
  body: Buffer;
}

export interface StorageProvider {
  readonly name: string;
  /**
   * Persist the bytes and return a public URL + opaque key.
   * Caller is responsible for MIME / size / quota validation.
   */
  put(opts: PutOptions): Promise<StorageObject>;
  /**
   * Best-effort delete. Returns true on success or "already gone" — false if
   * the object existed but could not be removed (caller may retry / log).
   */
  delete(storageKey: string): Promise<boolean>;
}
