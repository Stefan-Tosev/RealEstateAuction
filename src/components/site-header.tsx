import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { otherLocale, type Locale } from "@/lib/i18n/locales";
import { LanguageLink } from "./language-link";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

/*
 * Server component. The client pieces are the theme toggle (needs
 * localStorage), the language link (needs the current path to build its
 * counterpart URL) and the mobile nav (needs open/closed state).
 *
 * The nav links are declared once and rendered twice — the wide bar and
 * the narrow panel. Two hand-maintained copies is how one of them
 * quietly falls behind.
 */
export function SiteHeader({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);
  const other = otherLocale(locale);

  const links = [
    { href: `/${locale}/lots`, label: t.nav.lots },
    { href: `/${locale}/register`, label: t.register.heading },
    { href: `/${locale}/sign-in`, label: t.signIn.heading },
  ];

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="logo" href={`/${locale}/lots`}>
          <span className="logo-mark" aria-hidden="true">
            AH
          </span>
          {t.site.name}
        </Link>

        <nav className="main-nav" aria-label={t.site.name}>
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <div className="lang-toggle">
            {/* The current locale is a plain marker, not a link to itself. */}
            <span className="lang-link" aria-current="true">
              {locale.toUpperCase()}
            </span>
            <LanguageLink target={other} label={t.nav.switchLabel} />
          </div>
          <ThemeToggle labelToLight={t.nav.themeToLight} labelToDark={t.nav.themeToDark} />
        </div>

        {/*
          Below 860px .main-nav and .header-actions are hidden, so this
          panel carries the links, the language switch and the theme
          toggle — everything the wide header offers.
        */}
        <MobileNav label={t.nav.openMenu} closeLabel={t.nav.closeMenu}>
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}

          <div className="mobile-nav-actions">
            {/*
              The switch only, without the current-locale marker the wide
              header carries. Repeating the marker would put two
              aria-current="true" on the page for the same fact, and in a
              compact menu the useful control is "change it", not "here
              is what it already is".
            */}
            <div className="lang-toggle">
              <LanguageLink target={other} label={t.nav.switchLabel} />
            </div>
            <ThemeToggle labelToLight={t.nav.themeToLight} labelToDark={t.nav.themeToDark} />
          </div>
        </MobileNav>
      </div>
    </header>
  );
}
