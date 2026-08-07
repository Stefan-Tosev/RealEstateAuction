/*
 * The markets listing copy can be drafted for.
 *
 * Separate from src/lib/i18n, deliberately. That module is the languages
 * the *site* is served in, and adding one there means routes, dictionaries
 * and hreflang. This is only the languages copy can be written in, and
 * expanding it is a line in this file.
 *
 * The plan is Bulgaria, then the Balkans, then the EU. Making the
 * drafting side locale-parameterised now costs nothing; retrofitting it
 * after it has been written against two hardcoded fields is a rewrite.
 *
 * A market can be listed here before the site serves it — an operator
 * drafting Romanian copy ahead of the Romanian routes existing is a
 * perfectly sensible order to do things in.
 */

export type Market = {
  /** BCP-47, matching what the site would use if it served this locale. */
  code: string;
  /** In the language itself, because that is how an operator picks it. */
  label: string;
  /** Named so the model writes for a reader, not for a translator. */
  audience: string;
};

export const MARKETS: Market[] = [
  { code: "bg", label: "Български", audience: "buyers in Bulgaria" },
  { code: "en", label: "English", audience: "international buyers reading English" },
];

/*
 * Next, in the order the business expects to need them. Uncommenting one
 * is the whole of the work on this side; the site's own routing and
 * dictionaries are a separate and much larger job.
 *
 *   { code: "ro", label: "Română",      audience: "buyers in Romania" },
 *   { code: "el", label: "Ελληνικά",    audience: "buyers in Greece" },
 *   { code: "sr", label: "Српски",      audience: "buyers in Serbia" },
 *   { code: "de", label: "Deutsch",     audience: "buyers in German-speaking Europe" },
 */

/** The locales the site itself currently serves, and therefore must have copy for. */
export const REQUIRED_MARKET_CODES = ["bg", "en"];

export function marketFor(code: string): Market {
  const market = MARKETS.find((m) => m.code === code);
  if (!market) throw new Error(`No market configured for locale "${code}".`);
  return market;
}
