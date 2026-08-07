import type { LotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import { raiseEntryFee, raiseWithdrawalFee } from "@/server/fees/raise";
import type { AdminActor } from "@/server/identity/authz";
import { mediaStorage } from "@/server/storage";
import type { LotInput, PropertyInput } from "./schemas";
import { canTransition, publishBlockers } from "./publish";

/*
 * Operator-side reads and writes.
 *
 * Unlike src/server/catalogue/lots.ts, this file may legitimately read
 * the reserve — an auctioneer setting one has to see it. That is exactly
 * why it must never be imported by anything under src/app/(public):
 * the public guarantee is enforced by the select allowlists over there,
 * and this file deliberately does not use them.
 *
 * Every mutation writes an audit row. See src/server/audit/record.ts for
 * why that is not deferred.
 */

// ---------- Properties ----------

export function listProperties() {
  return prisma.property.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      titleBg: true,
      titleEn: true,
      city: true,
      propertyType: true,
      createdAt: true,
      _count: { select: { lots: true, images: true } },
    },
  });
}

export function getProperty(id: string) {
  return prisma.property.findUnique({
    where: { id },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function createProperty(actor: AdminActor, input: PropertyInput) {
  const property = await prisma.property.create({ data: input });

  await recordAudit({
    actorId: actor.id,
    action: "property.create",
    entityType: "property",
    entityId: property.id,
    after: property,
  });

  return property;
}

export async function updateProperty(actor: AdminActor, id: string, input: PropertyInput) {
  const before = await prisma.property.findUniqueOrThrow({ where: { id } });
  const after = await prisma.property.update({ where: { id }, data: input });

  await recordAudit({
    actorId: actor.id,
    action: "property.update",
    entityType: "property",
    entityId: id,
    before,
    after,
  });

  return after;
}

// ---------- Images ----------

export async function addPropertyImage(
  actor: AdminActor,
  propertyId: string,
  file: { storageKey: string; width: number; height: number; altBg: string; altEn: string },
) {
  // Append to the end of the gallery.
  const last = await prisma.propertyImage.findFirst({
    where: { propertyId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const image = await prisma.propertyImage.create({
    data: { propertyId, ...file, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });

  await recordAudit({
    actorId: actor.id,
    action: "image.add",
    entityType: "property_image",
    entityId: image.id,
    after: image,
  });

  return image;
}

export async function deletePropertyImage(actor: AdminActor, imageId: string) {
  const image = await prisma.propertyImage.findUniqueOrThrow({ where: { id: imageId } });

  await prisma.propertyImage.delete({ where: { id: imageId } });

  /*
   * Row first, then the file. If the file delete fails we are left with
   * an orphaned blob, which costs disk. The other order risks a row
   * pointing at nothing, which renders a broken image on a live listing.
   * Cheap wrong beats visible wrong.
   */
  await mediaStorage.delete(image.storageKey).catch(() => undefined);

  await recordAudit({
    actorId: actor.id,
    action: "image.delete",
    entityType: "property_image",
    entityId: imageId,
    before: image,
  });
}

export async function reorderPropertyImages(
  actor: AdminActor,
  propertyId: string,
  orderedIds: string[],
) {
  const before = await prisma.propertyImage.findMany({
    where: { propertyId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, sortOrder: true },
  });

  // One transaction: a half-applied order leaves the gallery scrambled.
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.propertyImage.update({
        where: { id, propertyId },
        data: { sortOrder: index },
      }),
    ),
  );

  await recordAudit({
    actorId: actor.id,
    action: "image.reorder",
    entityType: "property",
    entityId: propertyId,
    before,
    after: orderedIds.map((id, index) => ({ id, sortOrder: index })),
  });
}

// ---------- Lots ----------

export function listLots() {
  return prisma.lot.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      lotNumber: true,
      status: true,
      startingPriceMinor: true,
      reservePriceMinor: true,
      reserveAgreedBy: true,
      biddingOpensAt: true,
      effectiveCloseAt: true,
      property: {
        select: { slug: true, titleBg: true, city: true, _count: { select: { images: true } } },
      },
    },
  });
}

export function getLot(id: string) {
  return prisma.lot.findUnique({
    where: { id },
    include: {
      property: {
        select: {
          id: true,
          slug: true,
          titleBg: true,
          sellerId: true,
          // Admin only. Seller details are personal data and are never
          // selected into a public payload — see catalogue/select.ts.
          seller: { select: { id: true, name: true, email: true, phone: true } },
          _count: { select: { images: true } },
        },
      },
      reserveAgreedByAdmin: { select: { name: true, email: true } },
    },
  });
}

function lotDataFrom(input: LotInput) {
  return {
    lotNumber: input.lotNumber,
    startingPriceMinor: input.startingPriceMinor,
    reservePriceMinor: input.reservePriceMinor,
    bidIncrementMinor: input.bidIncrementMinor,
    depositRequiredMinor: input.depositRequiredMinor,
    previewStartsAt: input.previewStartsAt ? new Date(input.previewStartsAt) : null,
    biddingOpensAt: input.biddingOpensAt ? new Date(input.biddingOpensAt) : null,
    scheduledCloseAt: input.scheduledCloseAt ? new Date(input.scheduledCloseAt) : null,
  };
}

export async function createLot(actor: AdminActor, input: LotInput) {
  const data = lotDataFrom(input);

  const lot = await prisma.lot.create({
    data: {
      propertyId: input.propertyId,
      ...data,
      // effective_close_at tracks the scheduled close until the
      // soft-close engine moves it.
      effectiveCloseAt: data.scheduledCloseAt,
      status: "DRAFT",
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "lot.create",
    entityType: "lot",
    entityId: lot.id,
    after: lot,
  });

  return lot;
}

export async function updateLot(actor: AdminActor, id: string, input: LotInput) {
  const before = await prisma.lot.findUniqueOrThrow({ where: { id } });
  const data = lotDataFrom(input);

  const after = await prisma.lot.update({
    where: { id },
    data: {
      ...data,
      /*
       * Only follow the scheduled close while the lot has not started
       * extending. Once the soft-close engine owns effective_close_at,
       * an edit here must not yank the close back and cut an auction
       * short — that is the anti-snipe promise, broken by a form.
       */
      effectiveCloseAt:
        before.status === "EXTENDING" ? before.effectiveCloseAt : data.scheduledCloseAt,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "lot.update",
    entityType: "lot",
    entityId: id,
    before,
    after,
  });

  return after;
}

/** §10: the auctioneer agrees the reserve. Restricted to the admin role by the caller. */
export async function agreeReserve(actor: AdminActor, lotId: string) {
  const before = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });

  const after = await prisma.lot.update({
    where: { id: lotId },
    data: { reserveAgreedBy: actor.id, reserveAgreedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    action: "lot.agreeReserve",
    entityType: "lot",
    entityId: lotId,
    before,
    after,
  });

  return after;
}

export class TransitionRefused extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join(" "));
    this.name = "TransitionRefused";
    this.reasons = reasons;
  }
}

export async function changeLotStatus(actor: AdminActor, lotId: string, to: LotStatus) {
  const lot = await prisma.lot.findUniqueOrThrow({
    where: { id: lotId },
    include: {
      property: { select: { sellerId: true, _count: { select: { images: true } } } },
      // Kinds only. The publish gate checks that a document is present,
      // never what it says — see publish.ts on why that line matters.
      documents: { select: { kind: true } },
    },
  });

  if (!canTransition(lot.status, to)) {
    throw new TransitionRefused([`A lot cannot move from ${lot.status} to ${to}.`]);
  }

  if (to === "PUBLISHED") {
    const blockers = publishBlockers({
      reserveAgreedBy: lot.reserveAgreedBy,
      imageCount: lot.property._count.images,
      previewStartsAt: lot.previewStartsAt,
      biddingOpensAt: lot.biddingOpensAt,
      scheduledCloseAt: lot.scheduledCloseAt,
      documentKinds: lot.documents.map((document) => document.kind),
      sellerId: lot.property.sellerId,
    });
    if (blockers.length > 0) {
      throw new TransitionRefused(blockers.map((b) => b.message));
    }
  }

  const after = await prisma.lot.update({
    where: { id: lotId },
    data: {
      status: to,
      closedAt: to === "CANCELLED" ? new Date() : lot.closedAt,
    },
  });

  /*
   * §10's fees, at the moments they fall due.
   *
   * The entry fee is charged at publish and not at close, deliberately:
   * its whole defence is that it is "disclosed and charged BEFORE the
   * lot goes live, not levied as a penalty afterwards".
   *
   * Withdrawal is charged only when a PUBLISHED lot is pulled. A lot
   * cancelled while still a draft cost nobody anything.
   */
  if (to === "PUBLISHED") {
    await raiseEntryFee(lotId);
  } else if (to === "CANCELLED" && lot.status !== "DRAFT") {
    await raiseWithdrawalFee(lotId);
  }

  await recordAudit({
    actorId: actor.id,
    action: `lot.status.${to.toLowerCase()}`,
    entityType: "lot",
    entityId: lotId,
    before: { status: lot.status },
    after: { status: after.status },
  });

  return after;
}

/** Properties available to attach a new lot to. */
export function listPropertyOptions() {
  return prisma.property.findMany({
    orderBy: { titleBg: "asc" },
    select: { id: true, slug: true, titleBg: true },
  });
}

/** Next free lot number for a property, so the form can prefill it. */
export async function nextLotNumber(propertyId: string): Promise<number> {
  const last = await prisma.lot.findFirst({
    where: { propertyId },
    orderBy: { lotNumber: "desc" },
    select: { lotNumber: true },
  });
  return (last?.lotNumber ?? 10) + 1;
}
