import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n/locales";
import { listPublicLots } from "@/server/catalogue/lots";

/*
 * Statuses and "closing soon" are time-derived, so cached HTML is wrong
 * within a minute of being produced. Forcing dynamic also keeps
 * DATABASE_URL out of `next build`'s requirements. At Phase 1 traffic
 * this costs nothing; when it stops being free, swap to `revalidate` and
 * re-read the countdown notes in src/components/server-time-provider.tsx
 * first — a cached page must not embed a server timestamp.
 */
export const dynamic = "force-dynamic";

export default async function LotsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = getDictionary(locale);
  const lots = await listPublicLots(locale);

  return (
    <main>
      <h1>{t.lots.heading}</h1>
      {lots.length === 0 ? (
        <p>{t.lots.empty}</p>
      ) : (
        <ul>
          {lots.map((lot) => (
            <li key={lot.slug}>
              {lot.lotRef} — {lot.title} — {lot.priceFormatted}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
