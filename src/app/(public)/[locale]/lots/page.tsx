import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LotCard } from "@/components/lot-card";
import { getDictionary } from "@/lib/i18n";
import { localeAlternates } from "@/lib/i18n/alternates";
import { isLocale, OG_LOCALE, otherLocale, type Locale } from "@/lib/i18n/locales";
import { plural } from "@/lib/i18n/plural";
import { listPublicLots } from "@/server/catalogue/lots";

/*
 * Statuses and "closing soon" are time-derived, so cached HTML is wrong
 * within a minute of being produced. Forcing dynamic also keeps
 * DATABASE_URL out of `next build`'s requirements. At Phase 1 traffic
 * this costs nothing; when it stops being free, swap to `revalidate` and
 * read the caching note in src/app/api/time/route.ts first — a cached
 * page must not embed a server timestamp.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = getDictionary(locale);
  return {
    title: `${t.lots.heading} — ${t.site.name}`,
    description: t.site.tagline,
    alternates: localeAlternates(locale, "/lots"),
    openGraph: {
      locale: OG_LOCALE[locale],
      alternateLocale: OG_LOCALE[otherLocale(locale)],
    },
  };
}

export default async function LotsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = getDictionary(locale);
  const lots = await listPublicLots(locale as Locale);

  return (
    <main id="main" className="lots-section">
      <div className="container">
        <div className="lots-header">
          <div>
            <p className="eyebrow">{t.lots.eyebrow}</p>
            <h1 className="section-title">{t.lots.heading}</h1>
          </div>
          {lots.length > 0 ? (
            <p className="lots-count">{plural(locale, t.lots.count, lots.length)}</p>
          ) : null}
        </div>

        {lots.length === 0 ? (
          <div className="lots-empty">
            <p>{t.lots.empty}</p>
            <p>{t.lots.emptyHint}</p>
          </div>
        ) : (
          <div className="lots-grid">
            {lots.map((lot, index) => (
              <LotCard
                key={lot.slug}
                lot={lot}
                locale={locale}
                // Only the first row is above the fold on a desktop grid.
                priority={index < 3}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
