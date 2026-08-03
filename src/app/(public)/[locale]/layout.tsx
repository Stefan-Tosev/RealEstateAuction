import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n/locales";
import { ServerTimeProvider } from "@/components/server-time-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeScript } from "@/components/theme-script";
import { fontVariables } from "./fonts";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/chrome.css";
import "@/styles/catalogue.css";

/*
 * Root layout for the public catalogue. See (admin)/layout.tsx for why
 * there are two root layouts rather than one shared one.
 *
 * Guarding the locale here rather than with generateStaticParams means
 * /fr/lots 404s with no extra route configuration, and the check sits
 * next to the thing it protects.
 */

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = getDictionary(locale);

  return (
    <html lang={locale} className={fontVariables}>
      {/*
        theme-dark is the server's guess; ThemeScript corrects it before
        paint from localStorage or the OS preference. suppressHydrationWarning
        is required because of exactly that — see theme-script.tsx.
      */}
      <body className="theme-dark" suppressHydrationWarning>
        <ThemeScript />
        <a className="skip-link" href="#main">
          {t.site.skipToContent}
        </a>
        <ServerTimeProvider>
          <SiteHeader locale={locale} />
          {children}
          <SiteFooter locale={locale} />
        </ServerTimeProvider>
      </body>
    </html>
  );
}
