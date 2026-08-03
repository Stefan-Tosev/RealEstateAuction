/**
 * Where media files live.
 *
 * Local disk today; an S3-compatible bucket later. Keeping the surface
 * this small is what makes that a one-file change — nothing outside
 * src/server/storage knows whether a `storageKey` is a path or an object
 * key, and the database stores neither URLs nor filesystem paths.
 */
export interface MediaStorage {
  /** Browser-fetchable URL for a storage key. */
  publicUrl(storageKey: string): string;

  /** Write bytes at a key, replacing anything already there. */
  put(storageKey: string, data: Buffer): Promise<void>;

  /** Remove a key. Missing keys are not an error — deletion is idempotent. */
  delete(storageKey: string): Promise<void>;
}
