import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Countdown } from "@/components/countdown";
import { LotCard } from "@/components/lot-card";
import { LotGallery } from "@/components/lot-gallery";
import { getDictionary } from "@/lib/i18n";
import { localeAlternates } from "@/lib/i18n/alternates";
import { isLocale, OG_LOCALE, otherLocale } from "@/lib/i18n/locales";
import { getPublicLotBySlug, listSimilarLots } from "@/server/catalogue/lots";
import { getLotPack, resolveViewer } from "@/server/documents/lot-documents";
import { LegalPack } from "@/components/legal-pack";
import { ViewingsSection } from "@/components/viewings-section";
import { BidPanel } from "@/components/bid-panel";
import { getBiddingView } from "@/server/auction/bidding-view";
import { listPublicSlots } from "@/server/viewings/bookings";
import { formatDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  const lot = await getPublicLotBySlug(slug, locale);
  if (!lot) return {};

  const t = getDictionary(locale);
  return {
    title: `${lot.title} — ${t.site.name}`,
    description: lot.description.slice(0, 160),
    alternates: localeAlternates(locale, `/lots/${slug}`),
    openGraph: {
      title: lot.title,
      description: lot.description.slice(0, 160),
      locale: OG_LOCALE[locale],
      alternateLocale: OG_LOCALE[otherLocale(locale)],
      images: lot.images.length ? [{ url: lot.images[0].url }] : [],
    },
  };
}

export default async function LotDetailPage({ params }: Params) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const lot = await getPublicLotBySlug(slug, locale);
  // DRAFT and CANCELLED never resolve — the status allowlist in the
  // query, not a check here, is what enforces that.
  if (!lot) notFound();

  const t = getDictionary(locale);
  const similar = await listSimilarLots(lot, locale);

  /*
   * The pack is viewer-dependent: everyone sees which documents exist,
   * but filenames and links are gated. Resolved per request, so a
   * signed-in bidder and an anonymous visitor get different payloads
   * from the same URL.
   */
  const viewer = await resolveViewer();
  const pack = await getLotPack(lot.id, viewer);

  // Slot times are formatted server-side in Europe/Sofia, like every
  // other absolute date on the site.
  const bidderId = viewer.kind === "bidder" ? viewer.userId : null;
  const slots = await listPublicSlots(lot.id, bidderId, (date) => formatDateTime(date, locale));
  const bidding = await getBiddingView(lot.id, bidderId);
  const { phase } = lot;

  return (
    <main id="main" className="property-section">
      <div className="container">
        <Link className="breadcrumb" href={`/${locale}/lots`}>
          <span aria-hidden="true">&larr;</span>
          {t.detail.backToLots}
        </Link>

        <div className="property-layout">
          <div className="property-main">
            <LotGallery
              images={lot.images}
              gradientClass={lot.gradientClass}
              title={lot.title}
              lotChip={`${t.lot.chip} ${lot.lotRef}`}
            />

            <div className="property-header">
              <span className="property-type-tag">{t.propertyType[lot.propertyType]}</span>
              <h1 className="property-title">{lot.title}</h1>
              <p className="property-location">{lot.location}</p>
            </div>

            {lot.meta.length > 0 ? (
              <div className="key-details">
                {lot.meta.map((item) => (
                  <div className="key-detail" key={item}>
                    <span className="key-detail-value">{item}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <section className="property-description">
              <h2 className="section-title">{t.detail.description}</h2>
              <p>{lot.description}</p>
            </section>

            <BidPanel view={bidding} locale={locale} slug={slug} lotId={lot.id} />

            <LegalPack documents={pack} locale={locale} />

            <ViewingsSection
              slots={slots}
              locale={locale}
              slug={slug}
              isBidder={viewer.kind === "bidder"}
            />

            <section className="property-location-section">
              <h2 className="section-title">{t.detail.location}</h2>
              <p className="property-address">{lot.address}</p>
              <div className="map-placeholder">{t.detail.mapPlaceholder}</div>
            </section>
          </div>

          <div className="property-side">
            <div className="price-panel">
              <div className="price-panel-row">
                <div className="price-panel-main">
                  <span className="lot-price-label">
                    {lot.priceLabel === "openingBid" ? t.lot.openingBid : t.lot.currentBid}
                  </span>
                  <span className="price-panel-value">{lot.priceFormatted}</span>
                </div>

                {phase.kind === "preview" || phase.kind === "bidding" ? (
                  <div className="price-panel-countdown">
                    <span className="lot-price-label">
                      {phase.kind === "preview" ? t.lot.biddingOpensIn : t.lot.closesIn}
                    </span>
                    <Countdown
                      targetIso={phase.targetIso}
                      urgentWhenClose={phase.kind === "bidding"}
                      expiredLabel={t.lot.closed}
                      className="price-panel-countdown-value"
                    />
                  </div>
                ) : null}
              </div>

              {/*
                v1 ended this panel with a gold "Place Bid" button. There
                is deliberately none here: bidding is Phase 3 and
                registration is Phase 2, so it would link nowhere. A CTA
                that does nothing is worse than no CTA — it reads as a
                broken site rather than an honest one.
              */}
              {/*
                The increment is deliberately NOT shown from
                lot.incrementFormatted any more. That column is a per-lot
                override the engine may or may not use, and the bands are
                the other half of the answer — a page rendering one while
                placeBid enforces the other tells the bidder a price that
                will be refused. BidPanel shows the resolved figure,
                which is the same value the engine will accept.
              */}
              <p className="bid-increment-note">
                {phase.kind === "preview"
                  ? t.detail.biddingOpensNote.replace("{date}", phase.opensAtFormatted)
                  : phase.kind === "closed"
                    ? t.detail.biddingClosedNote
                    : t.detail.biddingOpenNote}
              </p>

              <dl className="key-dates">
                {lot.previewStartsAtFormatted ? (
                  <div className="key-date">
                    <dt>{t.detail.previewFrom}</dt>
                    <dd>{lot.previewStartsAtFormatted}</dd>
                  </div>
                ) : null}
                {lot.biddingOpensAtFormatted ? (
                  <div className="key-date">
                    <dt>{t.detail.biddingOpens}</dt>
                    <dd>{lot.biddingOpensAtFormatted}</dd>
                  </div>
                ) : null}
                {lot.scheduledCloseAtFormatted ? (
                  <div className="key-date">
                    <dt>{t.detail.scheduledClose}</dt>
                    <dd>{lot.scheduledCloseAtFormatted}</dd>
                  </div>
                ) : null}
                {phase.kind === "closed" && phase.closedAtFormatted ? (
                  <div className="key-date">
                    <dt>{t.detail.closedOn}</dt>
                    <dd>{phase.closedAtFormatted}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        </div>

        {similar.length > 0 ? (
          <section className="similar-properties">
            <h2 className="section-title">{t.detail.similar}</h2>
            <div className="lots-grid">
              {similar.map((item) => (
                <LotCard key={item.slug} lot={item} locale={locale} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
