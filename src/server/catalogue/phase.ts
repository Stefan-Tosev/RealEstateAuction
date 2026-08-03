import type { LotStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/datetime";
import type { Locale } from "@/lib/i18n/locales";
import type { LotPhase } from "./types";

/*
 * Where docs/architecture.md §1 is enforced:
 *
 *   PUBLISHED (21-day preview) — listing live, legal pack downloadable,
 *   viewings held, "**No bidding.**"
 *   BIDDING_OPEN / EXTENDING (5 days) — bidding, visible countdown.
 *
 * The two phases count down to different columns. v1 had a single
 * `data-close` per card and therefore no way to express this, which is
 * the main reason the card markup could not be ported verbatim.
 *
 * Derived from `status`, not from comparing timestamps to the clock:
 * the stored status is authoritative, and the soft-close engine (Phase 3)
 * owns the transitions. A page that second-guessed it by clock arithmetic
 * would disagree with the engine during the seconds around a close —
 * exactly when being wrong matters most.
 */

type PhaseInput = {
  status: LotStatus;
  biddingOpensAt: Date | null;
  effectiveCloseAt: Date | null;
  closedAt: Date | null;
};

export function derivePhase(lot: PhaseInput, locale: Locale): LotPhase {
  switch (lot.status) {
    case "PUBLISHED":
      return lot.biddingOpensAt
        ? {
            kind: "preview",
            targetIso: lot.biddingOpensAt.toISOString(),
            opensAtFormatted: formatDateTime(lot.biddingOpensAt, locale),
          }
        : { kind: "scheduled" };

    case "BIDDING_OPEN":
    case "EXTENDING":
      // effective_close_at is the authoritative close; scheduled_close_at
      // is the published one and never moves.
      return lot.effectiveCloseAt
        ? {
            kind: "bidding",
            targetIso: lot.effectiveCloseAt.toISOString(),
            closesAtFormatted: formatDateTime(lot.effectiveCloseAt, locale),
          }
        : { kind: "scheduled" };

    default:
      return {
        kind: "closed",
        closedAtFormatted: lot.closedAt ? formatDateTime(lot.closedAt, locale) : null,
      };
  }
}
