import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";

/*
 * Kept as a pure function rather than living inside middleware.ts so it
 * can be unit-tested without constructing a NextRequest.
 */

type AcceptEntry = { tag: string; q: number };

function parseAcceptLanguage(header: string): AcceptEntry[] {
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      // A missing q is 1.0 per RFC 9110; a malformed one is worth
      // ignoring rather than throwing on a header we do not control.
      const parsed = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(parsed) ? parsed : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);
}

/**
 * Cookie wins (it is an explicit choice the visitor made), then the
 * highest-weighted acceptable language whose primary subtag we serve,
 * then Bulgarian.
 */
export function negotiateLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;

  if (acceptLanguage) {
    for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
      // Match on the primary subtag so `bg-BG`, `en-US` and `en-GB` all
      // resolve. `*` is deliberately not special-cased — it means "any",
      // and our answer for "any" is the default.
      const primary = tag.split("-")[0];
      if (isLocale(primary)) return primary;
    }
  }

  return DEFAULT_LOCALE;
}
