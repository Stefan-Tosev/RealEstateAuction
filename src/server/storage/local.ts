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
 */
export const localMediaStorage: MediaStorage = {
  publicUrl: (storageKey) => `/media/${storageKey}`,
};
