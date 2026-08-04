import type { DocumentKind, DocumentVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
 * Who may download which document, and what everyone else is allowed to
 * know about it.
 *
 * §5 defines three tiers: headline info public, the full pack behind
 * registration, and a further tier for approved bidders. The purpose of
 * the gate is stated there too — it "captures serious leads and gives
 * you a demand signal before anyone bids".
 *
 * That purpose is why listing and downloading are separate questions. A
 * visitor who cannot see that a legal pack exists has no reason to
 * register for it, so the gate would capture nothing. Everyone sees the
 * pack's shape: which kinds of document exist, how big they are, and
 * what would be required to open them. Only the bytes — and the
 * filenames — are gated.
 *
 * Filenames are withheld deliberately. A document kind is generic and
 * expected: every lot has an encumbrances certificate. A filename is
 * not; in practice they carry addresses, owner names and case numbers.
 */

export type Viewer =
  | { kind: "anonymous" }
  | { kind: "bidder"; userId: string }
  /* Operators see everything; they are the ones who uploaded it. */
  | { kind: "admin" };

export type AccessDecision = {
  allowed: boolean;
  /** Why not, so the UI can explain rather than merely refuse. */
  reason?: "sign-in-required" | "approval-required";
};

/** May this viewer download the bytes? */
export async function canAccess(
  visibility: DocumentVisibility,
  viewer: Viewer,
): Promise<AccessDecision> {
  if (viewer.kind === "admin") return { allowed: true };

  switch (visibility) {
    case "public":
      return { allowed: true };

    case "registered":
      return viewer.kind === "bidder"
        ? { allowed: true }
        : { allowed: false, reason: "sign-in-required" };

    case "approved_bidders": {
      if (viewer.kind !== "bidder") return { allowed: false, reason: "sign-in-required" };

      /*
       * "Approved" means at least one row that is actually approved. A
       * user may have several — a rejection followed by a later
       * approval — so this asks the question rather than reading the
       * most recent row and hoping.
       *
       * Nothing writes these rows until Phase 2, so this tier is
       * currently downloadable by nobody. Deliberate: silently treating
       * "registered" as sufficient would disclose documents an operator
       * specifically restricted.
       */
      const approved = await prisma.bidderApproval.count({
        where: { userId: viewer.userId, status: "approved" },
      });

      return approved > 0 ? { allowed: true } : { allowed: false, reason: "approval-required" };
    }
  }
}

/**
 * What a viewer is told about a document they may not be able to open.
 *
 * `filename` is null unless they can actually download it — see the note
 * above on why kinds are safe to show and names are not.
 */
export type ListedDocument = {
  id: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  sizeBytes: number;
  mime: string;
  downloadable: boolean;
  /** Present only when downloadable. */
  filename: string | null;
  /** Why it cannot be downloaded, when it cannot. */
  reason?: "sign-in-required" | "approval-required";
};

type DocumentRow = {
  id: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  size: bigint;
  mime: string;
  filename: string;
};

/**
 * Redact a document for a viewer. Every document in a lot's pack is
 * listed; the gate decides how much of it is described.
 */
export async function describeForViewer(
  document: DocumentRow,
  viewer: Viewer,
): Promise<ListedDocument> {
  const decision = await canAccess(document.visibility, viewer);

  return {
    id: document.id,
    kind: document.kind,
    visibility: document.visibility,
    // bigint would not survive the crossing to a client component.
    sizeBytes: Number(document.size),
    mime: document.mime,
    downloadable: decision.allowed,
    filename: decision.allowed ? document.filename : null,
    ...(decision.reason ? { reason: decision.reason } : {}),
  };
}
