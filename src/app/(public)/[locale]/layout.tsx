import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/locales";

/*
 * Root layout for the public catalogue. See (admin)/layout.tsx for why
 * there are two root layouts rather than one shared one.
 *
 * Guarding the locale here rather than with generateStaticParams means
 * /fr/lots 404s with no extra route configuration, and the check lives
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

  return (
    <html lang={locale}>
      <body className="theme-dark">{children}</body>
    </html>
  );
}
