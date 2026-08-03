/**
 * Where media files live.
 *
 * Read-only for now: the catalogue only renders images, and the files
 * arrive via the seed. `put` and `signedUrl` land with the admin upload
 * pass — designing an upload API with no caller means designing it wrong.
 */
export interface MediaStorage {
  /** Browser-fetchable URL for a storage key. */
  publicUrl(storageKey: string): string;
}
