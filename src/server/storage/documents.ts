import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * Private document storage — legal packs.
 *
 * Deliberately NOT the media store. docs/architecture.md §5: "private
 * bucket, never in the web root". Property photographs are public
 * marketing assets served by a route handler with no auth; a нотариален
 * акт is not, and the two must not share a code path where someone can
 * later "simplify" them together.
 *
 * Nothing here is reachable by URL. The only way bytes leave this
 * directory is src/app/api/documents/[id]/route.ts, which checks a
 * signature and the caller's entitlement first.
 */

const DOCUMENT_ROOT = path.join(process.cwd(), "private", "documents");

/** Refuse any key that escapes the root — see the same guard in local.ts. */
function resolveKey(storageKey: string): string {
  const target = path.resolve(DOCUMENT_ROOT, storageKey);
  const root = path.resolve(DOCUMENT_ROOT);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Refusing document key outside the document root: ${storageKey}`);
  }
  return target;
}

export type StoredDocument = {
  storageKey: string;
  size: number;
  /** Recorded so a later integrity check can prove the file was not swapped. */
  sha256: string;
};

export async function putDocument(storageKey: string, data: Buffer): Promise<StoredDocument> {
  const target = resolveKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);

  return {
    storageKey,
    size: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

export async function readDocument(storageKey: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveKey(storageKey));
  } catch {
    return null;
  }
}

export async function deleteDocument(storageKey: string): Promise<void> {
  await rm(resolveKey(storageKey), { force: true });
}
