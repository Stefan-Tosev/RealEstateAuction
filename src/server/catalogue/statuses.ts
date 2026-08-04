import type { LotStatus } from "@prisma/client";

/*
 * Which lots the public may see, and where.
 *
 * The two lists differ on purpose. A lot that has finished should not
 * clutter the index, but its URL has been shared, indexed and emailed —
 * 404-ing it later is hostile and costs the search ranking the preview
 * period earned.
 */

/** Shown in the lots index. */
export const LISTABLE_LOT_STATUSES = [
  "PUBLISHED",
  "BIDDING_OPEN",
  "EXTENDING",
] as const satisfies readonly LotStatus[];

/**
 * Resolvable by direct URL — a superset of the listable set.
 *
 * RESERVE_NOT_MET is included but must render a *neutral* label
 * ("bidding closed"), never anything naming the reserve. Whether to
 * expose a met/not-met flag at all is still an open product question
 * (docs/architecture.md §11); this pass must not answer it by accident
 * through a status label.
 */
export const DETAIL_VISIBLE_LOT_STATUSES = [
  ...LISTABLE_LOT_STATUSES,
  "RESERVE_NOT_MET",
  "CLOSED_SOLD",
  "CLOSED_UNSOLD",
] as const satisfies readonly LotStatus[];

/** DRAFT and CANCELLED resolve nowhere. */
export function isPubliclyVisible(status: LotStatus): boolean {
  return (DETAIL_VISIBLE_LOT_STATUSES as readonly LotStatus[]).includes(status);
}
