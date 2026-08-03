import { localMediaStorage } from "./local";
import type { MediaStorage } from "./types";

/*
 * The single line that changes when object storage lands: swap the
 * implementation here and add `images.remotePatterns` to next.config.ts.
 * Nothing else in the app knows where files live — `storage_key` in the
 * database is storage-relative, never a URL.
 */
export const mediaStorage: MediaStorage = localMediaStorage;

export type { MediaStorage };
