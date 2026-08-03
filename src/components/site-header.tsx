import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { otherLocale, type Locale } from "@/lib/i18n/locales";
import { LanguageLink } from "./language-link";
import { ThemeToggle } from "./theme-toggle";

/*
 * Server component. The only client pieces are the theme toggle (needs
 * localStorage) and the language link (needs the current path to build
 * its counterpart URL).
 */
export function SiteHeader({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);
  const other = otherLocale(locale);

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
          <Link href={`/${locale}/lots`}>{t.nav.lots}</Link>
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
      </div>
    </header>
  );
}
