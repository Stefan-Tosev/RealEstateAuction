import { bg, type Dictionary } from "./dictionaries/bg";
import { en } from "./dictionaries/en";
import type { Locale } from "./locales";

const DICTIONARIES = { bg, en } satisfies Record<Locale, Dictionary>;

/*
 * Synchronous on purpose. These are a few KB of server-only strings; a
 * dynamic import would buy code-splitting the app does not need yet and
 * would make every server component that reads a label `await` it. When
 * the dictionaries are big enough to split, this signature becomes
 * `Promise<Dictionary>` in one file.
 *
 * Call sites read `t.lot.closesIn`, not `t("lot.closesIn")` — a dotted
 * string key is unchecked, so a typo becomes `undefined` in the page
 * instead of a build failure.
 */
export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export type { Dictionary };
export * from "./locales";
export * from "./plural";
export * from "./places";
export * from "./alternates";
export * from "./negotiate";
