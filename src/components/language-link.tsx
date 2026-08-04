"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/lib/i18n/locales";

/*
 * With route-based locales the language control is a link to the same
 * page under the other locale, not a button that swaps a body class.
 * That is the whole point of the routing change: the English version of
 * a lot has its own URL, so it can be shared, bookmarked and indexed.
 *
 * Needs to be a client component only because it reads the current path.
 */
export function LanguageLink({ target, label }: { target: Locale; label: string }) {
  const pathname = usePathname();

  // Swap the first segment. Falls back to the locale root if the path is
  // somehow not locale-prefixed.
  const segments = pathname.split("/").filter(Boolean);
  const isPrefixed = (LOCALES as readonly string[]).includes(segments[0] ?? "");
  const rest = isPrefixed ? segments.slice(1) : segments;
  const href = `/${[target, ...rest].join("/")}`;

  function rememberChoice() {
    // Persist so the "/" redirect honours the choice on the next visit.
    // max-age is a year; lax keeps it off cross-site requests.
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <Link className="lang-link" href={href} onClick={rememberChoice} aria-label={label}>
      {target.toUpperCase()}
    </Link>
  );
}
