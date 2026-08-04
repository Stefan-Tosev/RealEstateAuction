import { prisma } from "@/lib/prisma";
import { describeForViewer, type ListedDocument, type Viewer } from "./access";
import { signDocumentUrl } from "./signed-url";

/*
 * The legal pack for a lot, as a viewer is allowed to see it.
 *
 * Download URLs are minted here rather than in the component, because a
 * signed link is bound to the viewer it was issued to — building one in
 * a client component would mean shipping the signing secret to the
 * browser.
 */

export type PackDocument = ListedDocument & {
  /** Present only when downloadable; signed and short-lived. */
  href: string | null;
};

export function audienceFor(viewer: Viewer): string {
  switch (viewer.kind) {
    case "admin":
      return "admin";
    case "bidder":
      return `bidder:${viewer.userId}`;
    default:
      return "anonymous";
  }
}

export async function getLotPack(lotId: string, viewer: Viewer): Promise<PackDocument[]> {
  const documents = await prisma.lotDocument.findMany({
    where: { lotId },
    orderBy: [{ kind: "asc" }, { uploadedAt: "asc" }],
    select: {
      id: true,
      kind: true,
      visibility: true,
      size: true,
      mime: true,
      filename: true,
    },
  });

  const audience = audienceFor(viewer);

  return Promise.all(
    documents.map(async (document) => {
      const listed = await describeForViewer(document, viewer);
      return {
        ...listed,
        href: listed.downloadable ? signDocumentUrl(document.id, audience) : null,
      };
    }),
  );
}

/**
 * The viewer for the current request, derived from whichever session
 * exists. Kept here so every caller resolves it the same way.
 */
export async function resolveViewer(): Promise<Viewer> {
  const { currentAdmin, currentBidder } = await import("@/server/identity/authz");

  const admin = await currentAdmin();
  if (admin) return { kind: "admin" };

  const bidder = await currentBidder();
  if (bidder) return { kind: "bidder", userId: bidder.id };

  return { kind: "anonymous" };
}
