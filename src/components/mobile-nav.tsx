"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";

/*
 * The narrow-screen navigation.
 *
 * .main-nav is hidden below 860px — a rule ported from v1 along with the
 * rest of the header, except v1's hamburger never came with it. That was
 * harmless while the only nav item was "Lots", which the logo also
 * reaches; now that registration and sign-in are there, it is not.
 *
 * A details/summary element rather than a button and some state: it
 * opens and closes without JavaScript, is keyboard-operable for free,
 * and announces its expanded state to a screen reader without any aria
 * wiring of mine to get wrong.
 */
export function MobileNav({
  label,
  closeLabel,
  children,
}: {
  label: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="mobile-nav"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="nav-toggle" aria-label={open ? closeLabel : label}>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </summary>

      {/* Closing on navigation matters: without it the panel stays open
          over the page the visitor just asked for. */}
      <nav className="mobile-nav-panel" onClick={() => setOpen(false)}>
        {children}
      </nav>
    </details>
  );
}

export function MobileNavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href}>{children}</Link>;
}
