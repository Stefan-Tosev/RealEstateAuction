import type { DocumentKind, DocumentVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "@/server/identity/authz";
import { deleteDocument, putDocument } from "@/server/storage/documents";
import { safeFilename, validateDocument } from "./validate";

/*
 * Operator-side document management.
 *
 * Every mutation is audited. Who added a title deed to a lot, and who
 * removed one, is exactly the sort of question a dispute asks.
 */

export function listLotDocuments(lotId: string) {
  return prisma.lotDocument.findMany({
    where: { lotId },
    orderBy: [{ kind: "asc" }, { uploadedAt: "asc" }],
    include: { uploader: { select: { name: true } } },
  });
}

export async function addLotDocument(
  actor: AdminActor,
  lotId: string,
  input: {
    buffer: Buffer;
    filename: string;
    kind: DocumentKind;
    visibility: DocumentVisibility;
  },
): Promise<void> {
  const cleanName = safeFilename(input.filename);
  // Magic bytes decide the type; the name is only a claim.
  const format = validateDocument(input.buffer, cleanName);

  /*
   * A random key rather than the filename. Two lots may both have a
   * "нотариален акт.pdf", and a predictable key is one guess away from
   * being fetched by someone who should not have it — even though the
   * route checks entitlement, defence in depth costs nothing here.
   */
  const storageKey = `${lotId}/${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}.${format.extension}`;

  const stored = await putDocument(storageKey, input.buffer);

  const document = await prisma.lotDocument.create({
    data: {
      lotId,
      kind: input.kind,
      filename: cleanName,
      storageKey: stored.storageKey,
      size: BigInt(stored.size),
      mime: format.mime,
      // Recorded so the file can later be proven to be the one uploaded.
      sha256: stored.sha256,
      visibility: input.visibility,
      uploadedBy: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "document.add",
    entityType: "lot",
    entityId: lotId,
    after: { id: document.id, kind: document.kind, visibility: document.visibility, filename: cleanName },
  });
}

export async function removeLotDocument(actor: AdminActor, documentId: string): Promise<void> {
  const document = await prisma.lotDocument.findUniqueOrThrow({ where: { id: documentId } });

  await prisma.lotDocument.delete({ where: { id: documentId } });

  /*
   * Row first, then the file — same order as property images. An
   * orphaned blob costs disk; a row pointing at nothing produces a
   * broken download on a live listing.
   */
  await deleteDocument(document.storageKey).catch(() => undefined);

  await recordAudit({
    actorId: actor.id,
    action: "document.remove",
    entityType: "lot",
    entityId: document.lotId,
    before: {
      id: document.id,
      kind: document.kind,
      visibility: document.visibility,
      filename: document.filename,
      sha256: document.sha256,
    },
  });
}

export async function changeDocumentVisibility(
  actor: AdminActor,
  documentId: string,
  visibility: DocumentVisibility,
): Promise<void> {
  const before = await prisma.lotDocument.findUniqueOrThrow({ where: { id: documentId } });

  await prisma.lotDocument.update({ where: { id: documentId }, data: { visibility } });

  await recordAudit({
    actorId: actor.id,
    action: "document.visibility",
    entityType: "lot",
    entityId: before.lotId,
    before: { visibility: before.visibility },
    after: { visibility },
  });
}
