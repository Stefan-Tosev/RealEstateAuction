import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { LOCALE_COOKIE } from "@/lib/i18n/locales";
import { negotiateLocale } from "@/lib/i18n/negotiate";
import { authConfig } from "@/server/identity/auth.config";

/*
 * One middleware, two jobs, kept strictly apart by the pathname branch
 * below: locale negotiation for public URLs, session gating for /admin.
 *
 * Imports auth.config (edge-safe), never auth.ts — that one touches
 * Prisma and the native Argon2 addon and cannot run on the edge runtime.
 */

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // ---- Public: send un-prefixed URLs to a locale ----
  if (!pathname.startsWith("/admin")) {
    const locale = negotiateLocale(
      req.cookies.get(LOCALE_COOKIE)?.value,
      req.headers.get("accept-language"),
    );

    const target = new URL(
      `/${locale}${pathname === "/" ? "" : pathname}${req.nextUrl.search}`,
      req.nextUrl.origin,
    );

    /*
     * 307, not 308. The destination depends on a cookie and a header, so
     * a permanent redirect would be cached by the browser against the
     * wrong one — a visitor who switches to English would keep landing
     * on /bg with no way to clear it short of devtools.
     */
    const res = NextResponse.redirect(target, 307);
    res.headers.set("Vary", "Accept-Language, Cookie");
    return res;
  }

  // ---- Admin: unchanged from Phase 0 ----
  const isLoggedIn = !!req.auth;
  const isLoginPage = pathname === "/admin/login";

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/admin/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  }
});

export const config = {
  /*
   * Only paths that need rewriting or gating. Locale-prefixed URLs
   * (/bg/..., /en/...) are deliberately absent — they are already
   * correct, and running middleware on them would add a hop to every
   * page view for nothing.
   */
  matcher: ["/", "/lots/:path*", "/admin/:path*"],
};
