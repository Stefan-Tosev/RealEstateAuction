import type { ReactNode } from "react";
import { auth } from "@/server/identity/auth";
import { AdminNavLink } from "../_components/nav-link";
import { logoutAction } from "../actions";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/admin", enabled: true },
  { label: "Lots", href: "/admin/lots", enabled: true },
  { label: "Properties", href: "/admin/properties", enabled: true },
  { label: "Sellers", href: "/admin/sellers", enabled: true },
  { label: "Bidders", href: "/admin/bidders", enabled: true },
  { label: "Sales", href: "/admin/sales", enabled: true },
  { label: "Invoices", href: "/admin/invoices", enabled: true },
  { label: "Documents", href: "/admin/documents", enabled: false },
  { label: "Viewings", href: "/admin/viewings", enabled: false },
  { label: "Deposits", href: "/admin/deposits", enabled: false },
];

export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">Auction House Admin</div>
        <ul className="admin-nav">
          {NAV_ITEMS.map((item) =>
            item.enabled ? (
              <li key={item.href}>
                <AdminNavLink href={item.href} label={item.label} />
              </li>
            ) : (
              <li key={item.href}>
                <span className="admin-nav-link" data-disabled="true">
                  {item.label}
                  <span className="admin-nav-soon">soon</span>
                </span>
              </li>
            ),
          )}
        </ul>
        <div className="admin-sidebar-footer">
          <div>{session?.user?.name ?? session?.user?.email}</div>
          <form action={logoutAction}>
            <button type="submit">Log out</button>
          </form>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
