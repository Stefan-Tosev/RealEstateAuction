import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaStorage } from "./types";

/*
 * Local disk. Files sit under `public/media/<storageKey>` and are served
 * by Next's static handler — which is why next/image needs no
 * `remotePatterns` entry for them.
 *
 * Note the asymmetry with lot_documents, and keep it: legal packs are
 * private and must never live in the web root (docs/architecture.md §5 —
 * private bucket, signed URLs, Content-Disposition: attachment).
 * Property photographs are public marketing assets, so the public
 * directory is right for them, and only for them.
 *
 * A caveat for deployment: writes here do not survive a container
 * rebuild, and do not exist on a second instance. That is fine while
 * this is one box, and it is the reason the interface exists — the swap
 * to object storage changes this file and nothing else.
 */

const MEDIA_ROOT = path.join(process.cwd(), "public", "media");

/**
 * Resolve a key to an absolute path, refusing anything that escapes the
 * media root. Keys are built by our own code today, but a traversal
 * sequence reaching this function would be writing arbitrary files as
 * the server user — worth one comparison to make impossible.
 */
function resolveKey(storageKey: string): string {
  const target = path.resolve(MEDIA_ROOT, storageKey);
  const root = path.resolve(MEDIA_ROOT);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Refusing storage key outside the media root: ${storageKey}`);
  }
  return target;
}

export const localMediaStorage: MediaStorage = {
  publicUrl: (storageKey) => `/media/${storageKey}`,

  async put(storageKey, data) {
    const target = resolveKey(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  },

  async delete(storageKey) {
    // `force` makes a missing file a no-op rather than an ENOENT, so a
    // half-finished delete can safely be retried.
    await rm(resolveKey(storageKey), { force: true });
  },
};
