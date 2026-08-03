import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveKey } from "@/server/storage/local";

/*
 * Serves property photographs from local disk.
 *
 * These used to live in `public/` and be served statically. They cannot:
 * Next builds a manifest of that directory at build time, so anything
 * uploaded at runtime is invisible to `next start` — the upload feature
 * worked in development and 404'd in production.
 *
 * Note this route is deliberately outside the middleware matcher, so it
 * takes no locale redirect and no session check. Property photography is
 * public marketing material. Legal-pack documents are NOT, and must
 * never be served this way — they need auth and signed, short-lived URLs
 * (docs/architecture.md §5).
 */

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const { key } = await context.params;
  const storageKey = key.join("/");

  let filePath: string;
  try {
    // Throws on any key that escapes the media root.
    filePath = resolveKey(storageKey);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  // Only ever serve image types. An unknown extension is a 404 rather
  // than an octet-stream download of whatever happens to be there.
  if (!contentType) return new NextResponse("Not found", { status: 404 });

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return new NextResponse("Not found", { status: 404 });

  /*
   * Weak ETag from size and mtime. Uploads get unique filenames so they
   * could be cached immutably, but seeded files reuse names like
   * `01.jpg` — revalidation keeps both correct without a stale image
   * surviving a replacement.
   */
  const etag = `W/"${createHash("sha1")
    .update(`${info.size}-${info.mtimeMs}`)
    .digest("hex")
    .slice(0, 16)}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { etag } });
  }

  const body = await readFile(filePath);

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": contentType,
      "content-length": String(info.size),
      etag,
      "cache-control": "public, max-age=0, must-revalidate",
      // Belt and braces: never let a served file be sniffed into
      // something executable.
      "x-content-type-options": "nosniff",
    },
  });
}
