/*
 * The site's locale set. Bulgarian is the default: this is a Bulgarian
 * auction house, and English exists for foreign bidders.
 *
 * Prisma also generates a `Locale` enum (User.locale, for notification
 * language). The two are structurally identical on purpose. Import
 * Prisma's as `Locale as DbLocale` where both are in scope;
 * tests/unit/i18n.test.ts asserts they stay assignable.
 */

export const LOCALES = ["bg", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "bg";

/**
 * Full BCP-47 tags for `Intl`. `en-GB` rather than `en-US`: European
 * date order and euro symbol placement, for a site whose only market is
 * Bulgaria.
 */
export const BCP47: Record<Locale, string> = {
  bg: "bg-BG",
  en: "en-GB",
};

/** Open Graph locale codes. */
export const OG_LOCALE: Record<Locale, string> = {
  bg: "bg_BG",
  en: "en_GB",
};

/** The de-facto convention Next tooling expects. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The other locale — the language toggle's target. */
export function otherLocale(locale: Locale): Locale {
  return locale === "bg" ? "en" : "bg";
}
