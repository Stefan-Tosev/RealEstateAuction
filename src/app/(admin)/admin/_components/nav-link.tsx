"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/*
 * Marks the current section.
 *
 * The dashboard layout previously hardcoded data-active="true" on every
 * enabled item, which looked right only because exactly one item was
 * enabled. Enabling a second would have highlighted both.
 *
 * "/admin" matches only itself; everything else matches its subtree, so
 * /admin/lots/<id> keeps "Lots" highlighted.
 */
export function AdminNavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <Link
      className="admin-nav-link"
      href={href}
      data-active={isActive ? "true" : undefined}
      aria-current={isActive ? "page" : undefined}
    >
      {label}
    </Link>
  );
}
