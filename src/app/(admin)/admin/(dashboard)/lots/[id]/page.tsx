import Link from "next/link";
import { notFound } from "next/navigation";
import { getLot, listPropertyOptions } from "@/server/catalogue/admin";
import { allowedTransitions, publishBlockers } from "@/server/catalogue/publish";
import { requireAdmin, canPerform } from "@/server/identity/authz";
import { LotControls } from "../lot-controls";
import { LotForm, type LotFormValues } from "../lot-form";
import { listLotDocuments } from "@/server/documents/admin";
import { listSlotsForLot } from "@/server/viewings/bookings";
import { DocumentManager } from "./document-manager";
import { SlotManager } from "./slot-manager";

export const dynamic = "force-dynamic";

/**
 * `datetime-local` inputs want `YYYY-MM-DDTHH:mm` with no zone. The
 * operator works in Sofia time, so render the stored UTC instant in that
 * zone rather than the server's.
 */
function toLocalInput(date: Date | null): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Minor units back to the major-unit string the form edits. */
function toMajor(minor: bigint | null): string {
  if (minor === null) return "";
  const whole = minor / 100n;
  const cents = minor % 100n;
  return cents === 0n ? whole.toString() : `${whole}.${cents.toString().padStart(2, "0")}`;
}

export default async function EditLotPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();

  const { id } = await params;
  const lot = await getLot(id);
  if (!lot) notFound();

  const properties = await listPropertyOptions();
  const documents = await listLotDocuments(lot.id);
  const slots = await listSlotsForLot(lot.id);

  const sofia = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const blockers = publishBlockers({
    reserveAgreedBy: lot.reserveAgreedBy,
    imageCount: lot.property._count.images,
    previewStartsAt: lot.previewStartsAt,
    biddingOpensAt: lot.biddingOpensAt,
    scheduledCloseAt: lot.scheduledCloseAt,
  });

  const values: LotFormValues = {
    id: lot.id,
    propertyId: lot.property.id,
    lotNumber: lot.lotNumber,
    startingPriceMajor: toMajor(lot.startingPriceMinor),
    reservePriceMajor: toMajor(lot.reservePriceMinor),
    bidIncrementMajor: toMajor(lot.bidIncrementMinor),
    depositRequiredMajor: toMajor(lot.depositRequiredMinor),
    previewStartsAt: toLocalInput(lot.previewStartsAt),
    biddingOpensAt: toLocalInput(lot.biddingOpensAt),
    scheduledCloseAt: toLocalInput(lot.scheduledCloseAt),
    isDraft: lot.status === "DRAFT",
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>
            Lot {String(lot.lotNumber).padStart(3, "0")} — {lot.property.titleBg}
          </h1>
          <p>
            <span className="admin-chip" data-status={lot.status}>
              {lot.status}
            </span>{" "}
            ·{" "}
            <Link href={`/admin/properties/${lot.property.id}`}>
              property ({lot.property._count.images} photo
              {lot.property._count.images === 1 ? "" : "s"})
            </Link>
            {lot.reserveAgreedByAdmin ? (
              <> · reserve agreed by {lot.reserveAgreedByAdmin.name}</>
            ) : null}
          </p>
        </div>
        <Link className="admin-btn" href="/admin/lots">
          Back to lots
        </Link>
      </div>

      <LotControls
        lotId={lot.id}
        status={lot.status}
        transitions={allowedTransitions(lot.status)}
        blockers={blockers.map((b) => b.message)}
        reserveAgreed={Boolean(lot.reserveAgreedBy)}
        canActAsAuctioneer={canPerform(actor.role, "lot.publish")}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--admin-border)", margin: "2rem 0" }} />

      <DocumentManager
        lotId={lot.id}
        documents={documents.map((document) => ({
          id: document.id,
          kind: document.kind,
          visibility: document.visibility,
          filename: document.filename,
          // bigint does not cross into a client component.
          sizeBytes: Number(document.size),
          uploadedBy: document.uploader.name,
          uploadedAt: sofia.format(document.uploadedAt),
        }))}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--admin-border)", margin: "2rem 0" }} />

      <SlotManager
        lotId={lot.id}
        slots={slots.map((slot) => ({
          id: slot.id,
          startsAtFormatted: sofia.format(slot.startsAt),
          durationMinutes: slot.durationMinutes,
          capacity: slot.capacity,
          booked: slot._count.bookings,
          kind: slot.kind,
          isPast: slot.startsAt.getTime() <= Date.now(),
        }))}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--admin-border)", margin: "2rem 0" }} />

      <LotForm lot={values} properties={properties} defaultLotNumber={lot.lotNumber} />
    </div>
  );
}
