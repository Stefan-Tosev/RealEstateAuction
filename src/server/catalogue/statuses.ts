import type { LotStatus } from "@prisma/client";
import { keysWhere } from "@/lib/exhaustive";

/*
 * Which lots the public may see, and where.
 *
 * The two sets differ on purpose. A lot that has finished should not
 * clutter the index, but its URL has been shared, indexed and emailed —
 * 404-ing it later is hostile and costs the search ranking the preview
 * period earned.
 *
 * Records rather than arrays so a new LotStatus cannot default to
 * invisible. An unlisted lot is a lot nobody can find, and an array would
 * report nothing at all.
 */

/** Shown in the lots index. */
const LISTABLE: Record<LotStatus, boolean> = {
  PUBLISHED: true,
  BIDDING_OPEN: true,
  EXTENDING: true,

  // Not yet public, or no longer worth the index.
  DRAFT: false,
  CANCELLED: false,
  RESERVE_NOT_MET: false,
  CLOSED_SOLD: false,
  CLOSED_UNSOLD: false,
};

/**
 * Resolvable by direct URL — a superset of the listable set, and spread
 * from it so that stays true by construction rather than by both lists
 * happening to agree.
 *
 * RESERVE_NOT_MET is included but must render a *neutral* label
 * ("bidding closed"), never anything naming the reserve. Whether to
 * expose a met/not-met flag at all is still an open product question
 * (docs/architecture.md §11); this pass must not answer it by accident
 * through a status label.
 */
const DETAIL_VISIBLE: Record<LotStatus, boolean> = {
  ...LISTABLE,
  RESERVE_NOT_MET: true,
  CLOSED_SOLD: true,
  CLOSED_UNSOLD: true,
};

export const LISTABLE_LOT_STATUSES = keysWhere(LISTABLE);
export const DETAIL_VISIBLE_LOT_STATUSES = keysWhere(DETAIL_VISIBLE);

/** DRAFT and CANCELLED resolve nowhere. */
export function isPubliclyVisible(status: LotStatus): boolean {
  return DETAIL_VISIBLE[status];
}
