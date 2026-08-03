import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaStorage } from "./types";

/*
 * Local disk, at `<repo>/media/<storageKey>`, served by the route
 * handler at src/app/media/[...key]/route.ts.
 *
 * NOT `public/`. Next builds a static manifest of that directory at
 * build time, so a file written there at runtime is simply not served —
 * uploads worked perfectly under `next dev` and 404'd under
 * `next start`. Serving through a route handler costs a Node hop and
 * makes dev and production behave identically, which is the trade worth
 * making.
 *
 * A caveat for deployment: writes here do not survive a container
 * rebuild, and do not exist on a second instance. That is fine while
 * this is one box, and it is the reason the interface exists — the swap
 * to object storage changes this file and nothing else.
 */

const MEDIA_ROOT = path.join(process.cwd(), "media");

/**
 * Resolve a key to an absolute path, refusing anything that escapes the
 * media root. Keys are built by our own code today, but a traversal
 * sequence reaching this function would be writing arbitrary files as
 * the server user — worth one comparison to make impossible.
 */
export function resolveKey(storageKey: string): string {
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
