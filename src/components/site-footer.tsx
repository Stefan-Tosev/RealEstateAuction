import { getDictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="logo">
              <span className="logo-mark" aria-hidden="true">
                AH
              </span>
              {t.site.name}
            </span>
            <p>{t.site.tagline}</p>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="container">
          <p>
            © {new Date().getFullYear()} {t.site.name}. {t.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
