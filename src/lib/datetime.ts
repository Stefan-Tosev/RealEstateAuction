import { BCP47, type Locale } from "./i18n/locales";

/*
 * All timestamps are stored as timestamptz and reasoned about in UTC;
 * they are *displayed* in Europe/Sofia (docs/architecture.md §2).
 *
 * The rule that keeps server rendering safe: every absolute date is
 * formatted here, on the server, and crosses to the client as an
 * already-formatted string. The only time arithmetic in the browser is
 * the countdown, which is a duration and therefore timezone-independent.
 *
 * Skip that rule and you get the classic hydration mismatch — the server
 * renders 19:00 EEST, the visitor's machine renders 16:00 UTC, React
 * throws them away and re-renders. Formatting server-side removes the
 * entire class of bug rather than patching instances of it.
 */
export const SOFIA_TZ = "Europe/Sofia";

function toDate(value: string | Date): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** e.g. "14 август 2026 г., 19:00" / "14 August 2026 at 19:00" */
export function formatDateTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(BCP47[locale], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: SOFIA_TZ,
  }).format(toDate(value));
}

/** e.g. "14 август 2026 г." / "14 August 2026" */
export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(BCP47[locale], {
    dateStyle: "long",
    timeZone: SOFIA_TZ,
  }).format(toDate(value));
}
