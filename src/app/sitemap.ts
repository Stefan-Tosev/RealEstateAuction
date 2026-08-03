import type { MetadataRoute } from "next";
import { LOCALES } from "@/lib/i18n/locales";
import { listPublicLots } from "@/server/catalogue/lots";

/*
 * Both locales for every public URL, with per-entry language alternates.
 * Route-based locales only earn their keep if crawlers are told the
 * counterpart URLs exist.
 */

export const dynamic = "force-dynamic";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function alternatesFor(path: string) {
  return {
    languages: Object.fromEntries(LOCALES.map((l) => [l, `${siteUrl}/${l}${path}`])),
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Slugs do not differ by locale, so one query serves both.
  const lots = await listPublicLots("bg");

  const paths = ["/lots", ...lots.map((lot) => `/lots/${lot.slug}`)];

  return paths.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: `${siteUrl}/${locale}${path}`,
      lastModified: new Date(),
      alternates: alternatesFor(path),
    })),
  );
}
