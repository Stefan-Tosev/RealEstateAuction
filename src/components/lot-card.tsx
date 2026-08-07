import Link from "next/link";
import { URGENT_THRESHOLD_MS } from "@/lib/countdown";
import { getDictionary } from "@/lib/i18n";
import { premiumRateLabel } from "@/server/fees/disclosure";
import type { Locale } from "@/lib/i18n/locales";
import type { PublicLotSummary } from "@/server/catalogue/types";
import { Countdown } from "./countdown";
import { LotImage } from "./lot-image";

const CARD_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

/*
 * v1's renderLotCard(), as a server component. Markup and class names
 * are unchanged so the ported CSS applies as-is; what differs is the
 * price row, which now has to say *which* clock it is showing.
 */
export function LotCard({
  lot,
  locale,
  priority = false,
}: {
  lot: PublicLotSummary;
  locale: Locale;
  priority?: boolean;
}) {
  const t = getDictionary(locale);
  const href = `/${locale}/lots/${lot.slug}`;
  const { phase } = lot;

  const premiumLabel = t.bidding.premiumShort.replace("{rate}", premiumRateLabel());

  /*
   * Badge choice. Computed on the server, which is safe because the page
   * is force-dynamic and the server clock is the authoritative one — the
   * same clock /api/time serves to the countdown.
   */
  let badge: { label: string; className: string } | null = null;
  if (phase.kind === "preview") {
    badge = { label: t.lot.badgePreview, className: "lot-status-preview" };
  } else if (lot.status === "EXTENDING") {
    badge = { label: t.lot.badgeExtending, className: "lot-status-closing" };
  } else if (phase.kind === "bidding") {
    const remaining = Date.parse(phase.targetIso) - Date.now();
    if (remaining > 0 && remaining <= URGENT_THRESHOLD_MS) {
      badge = { label: t.lot.badgeClosingSoon, className: "lot-status-closing" };
    }
  }

  const countdownLabel =
    phase.kind === "preview" ? t.lot.biddingOpensIn : t.lot.closesIn;

  return (
    <article className="lot-card">
      <div className="lot-card-media">
        <Link href={href} aria-label={lot.title}>
          <span className="lot-tag">
            {t.lot.chip} {lot.lotRef}
          </span>
          <LotImage
            image={lot.image}
            gradientClass={lot.gradientClass}
            alt={lot.title}
            sizes={CARD_SIZES}
            priority={priority}
          />
        </Link>
        {badge ? <span className={`lot-status ${badge.className}`}>{badge.label}</span> : null}
      </div>

      <div className="lot-card-body">
        <h3 className="lot-title">
          <Link href={href}>{lot.title}</Link>
        </h3>
        <p className="lot-location">{lot.location}</p>

        <div className="lot-meta">
          {/* v1 showed the first three; the rest live on the detail page. */}
          {lot.meta.slice(0, 3).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        <div className="lot-price-row">
          <div>
            <span className="lot-price-label">
              {lot.priceLabel === "openingBid" ? t.lot.openingBid : t.lot.currentBid}
            </span>
            <span className="lot-price">{lot.priceFormatted}</span>
            {/* Every price a bidder sees, including this one. */}
            <span className="lot-premium">{premiumLabel}</span>
          </div>

          {phase.kind === "preview" || phase.kind === "bidding" ? (
            <div className="lot-countdown-wrap">
              <span className="lot-price-label">{countdownLabel}</span>
              <Countdown
                targetIso={phase.targetIso}
                urgentWhenClose={phase.kind === "bidding"}
                expiredLabel={t.lot.closed}
              />
            </div>
          ) : null}
        </div>

        <Link className="btn btn-outline btn-full" href={href}>
          {t.lot.viewLot.replace("{n}", lot.lotRef)}
        </Link>
      </div>
    </article>
  );
}
