import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./admin/admin.css";

/*
 * Root layout for the admin tool.
 *
 * There are two root layouts in this app — this one and the public
 * catalogue's at (public)/[locale]/layout.tsx. Only one component may
 * own <html>, and the public one needs `params.locale` to set its lang
 * attribute, which a shared root at src/app/layout.tsx cannot read.
 *
 * Route groups are URL-invisible, so /admin/login is still /admin/login.
 * Crossing between the admin and the public site is a full document load
 * rather than a client transition; they are different applications and
 * nobody navigates between them mid-task.
 *
 * lang="en" is deliberate: the admin tool is English-only. The bilingual
 * requirement is about what bidders and sellers read, not about the
 * operator console.
 */

export const metadata: Metadata = {
  title: "Auction House Admin",
  // Belt and braces alongside robots.ts — an operator console has no
  // business in an index.
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
