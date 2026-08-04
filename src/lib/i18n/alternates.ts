import { LOCALES, type Locale } from "./locales";

/*
 * hreflang alternates. Route-based locales only pay off for SEO if the
 * counterpart URLs are actually declared, so every public page goes
 * through this helper rather than hand-rolling `alternates`.
 */

/**
 * @param locale the page's own locale — decides the canonical URL
 * @param path   locale-agnostic path with a leading slash, e.g. "/lots/foo"
 */
export function localeAlternates(locale: Locale, path: string) {
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `/${l}${path}`]),
  ) as Record<Locale, string>;

  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...languages,
      // Bulgarian is what an unmatched crawler should land on: this is a
      // Bulgarian auction house, and the listings are physically here.
      "x-default": `/bg${path}`,
    },
  };
}

/** The same path under the other locale — what the language toggle links to. */
export function localePath(locale: Locale, path: string): string {
  return `/${locale}${path}`;
}
