import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccess, type Viewer } from "@/server/documents/access";
import { verifyDocumentSignature } from "@/server/documents/signed-url";
import { currentAdmin, currentBidder } from "@/server/identity/authz";
import { readDocument } from "@/server/storage/documents";

/*
 * The only way a legal-pack document leaves the server.
 *
 * §5, in order of importance:
 *
 *  - Never render a user-supplied PDF inline from our own origin. That
 *    is same-origin XSS: a crafted PDF runs script in the context of
 *    this site, with this site's cookies. Hence
 *    `Content-Disposition: attachment`, unconditionally, with nosniff
 *    and a restrictive CSP alongside it.
 *
 *  - Entitlement is re-checked here on every request. The signature
 *    proves the link was minted by us and is fresh; it does not prove
 *    the person clicking it is still entitled. Revoking access must take
 *    effect immediately, not when a link happens to expire.
 *
 *  - 404, never 403, for a document the caller may not have. A 403 says
 *    "this exists and you cannot have it", which is itself a
 *    disclosure — that a given lot has an encumbrances certificate is
 *    information.
 */

export const dynamic = "force-dynamic";

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const admin = await currentAdmin();
  const bidder = admin ? null : await currentBidder();

  const viewer: Viewer = admin
    ? { kind: "admin" }
    : bidder
      ? { kind: "bidder", userId: bidder.id }
      : { kind: "anonymous" };

  // The audience the link was minted for. A link issued to one bidder
  // does not work for another, or for a signed-out visitor.
  const audience = admin ? `admin:${admin.id}` : bidder ? `bidder:${bidder.id}` : "anonymous";

  const url = new URL(request.url);
  const verdict = verifyDocumentSignature(
    id,
    audience,
    url.searchParams.get("exp"),
    url.searchParams.get("sig"),
  );
  if (verdict !== "ok") return notFound();

  const document = await prisma.lotDocument.findUnique({ where: { id } });
  if (!document) return notFound();

  const decision = await canAccess(document.visibility, viewer);
  if (!decision.allowed) return notFound();

  const bytes = await readDocument(document.storageKey);
  if (!bytes) return notFound();

  /*
   * RFC 5987 encoding for the filename: legal packs are named in
   * Bulgarian, and a raw Cyrillic filename in a header is not portable.
   * The ASCII fallback keeps older clients working.
   */
  const asciiName = document.filename.replace(/[^\x20-\x7E]/g, "_");
  const disposition =
    `attachment; filename="${asciiName}"; ` +
    `filename*=UTF-8''${encodeURIComponent(document.filename)}`;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": document.mime,
      "content-length": String(bytes.byteLength),
      "content-disposition": disposition,
      // Never let a browser sniff its way to executing this.
      "x-content-type-options": "nosniff",
      // Belt and braces if a client ignores the disposition anyway.
      "content-security-policy": "default-src 'none'; sandbox",
      // A signed link is personal; no shared cache should keep it.
      "cache-control": "private, no-store",
    },
  });
}
