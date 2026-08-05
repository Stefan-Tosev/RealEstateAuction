import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";
import { interpolate, plural } from "@/lib/i18n/plural";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";
import type { BiddingView } from "@/server/auction/bidding-view";
import { BidForm } from "./bid-form";

/*
 * The bid panel on the lot page.
 *
 * Eligibility arrives as a reason rather than a boolean, so each state
 * says what would change it. "You cannot bid" is useless to someone one
 * step away from being able to.
 *
 * Bidder identities are never shown — the recent-bid list is numbered
 * ("Наддаващ 1" / "Bidder 1"). Anyone can verify the shape of the
 * bidding without being handed the means to approach a rival or a buyer
 * directly.
 */
export function BidPanel({
  view,
  locale,
  slug,
  lotId,
}: {
  view: BiddingView;
  locale: Locale;
  slug: string;
  lotId: string;
}) {
  const t = getDictionary(locale);

  const currentLabel = view.currentMinor ? t.bidding.currentBid : t.bidding.openingBid;
  const currentValue = view.currentMinor
    ? formatMoney(view.currentMinor, locale)
    : formatMoney(view.minimumMinor, locale);

  return (
    <section className="bidding" id="bidding">
      <h2 className="section-title">{t.bidding.heading}</h2>

      <div className="bid-summary">
        <div>
          <span className="lot-price-label">{currentLabel}</span>
          <span className="bid-current">{currentValue}</span>
        </div>
        <div className="bid-count">
          {view.bidCount === 0
            ? t.bidding.noBids
            : plural(locale, t.bidding.bidCount, view.bidCount)}
        </div>
      </div>

      {view.eligibility.canBid ? (
        <>
          <p className="bid-minimum">
            {t.bidding.nextBid.replace("{amount}", formatMoney(view.minimumMinor, locale))}
          </p>
          <BidForm
            locale={locale}
            slug={slug}
            lotId={lotId}
            amountMinor={view.minimumMinor}
            amountFormatted={formatMoney(view.minimumMinor, locale)}
            /*
             * Identifies this attempt. Both parts move the moment a bid
             * lands — the count always, the price whenever the bid was
             * the new highest — so a retry of one attempt is deduped
             * while a genuine follow-up bid is not.
             */
            attempt={`${view.bidCount}:${view.currentMinor ?? "0"}`}
            labels={{
              // bidCount is plural forms rather than a string, and the
              // form has no use for it.
              ...(({ bidCount, ...rest }) => rest)(t.bidding),
              stepHint: t.bidding.stepHint.replace(
                "{step}",
                formatMoney(view.incrementMinor, locale),
              ),
            }}
          />
        </>
      ) : (
        <p className="bid-blocked">
          {view.eligibility.reason === "not-signed-in" ? (
            <Link className="btn btn-brass" href={`/${locale}/sign-in`}>
              {t.bidding.signInToBid}
            </Link>
          ) : view.eligibility.reason === "not-approved" ? (
            t.bidding.notApproved
          ) : view.eligibility.reason === "no-deposit" ? (
            t.bidding.needDeposit
          ) : (
            t.bidding.notOpen
          )}
        </p>
      )}

      {view.recentBids.length > 0 ? (
        <div className="bid-history">
          <h3 className="bid-history-heading">{t.bidding.history}</h3>
          <ol>
            {view.recentBids.map((bid) => (
              <li key={`${bid.bidderIndex}-${bid.atIso}`}>
                <span className="bid-history-who">
                  {interpolate(t.bidding.bidderLabel, locale, bid.bidderIndex)}
                </span>
                <span className="bid-history-amount">{formatMoney(bid.amountMinor, locale)}</span>
                <span className="bid-history-when">
                  {formatDateTime(bid.atIso, locale)}
                  {bid.extended ? ` · ${t.bidding.extended}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
