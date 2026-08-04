import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

/*
 * A not-found boundary cannot read route params, so it cannot know the
 * locale — this fires for /fr/lots as well as for a missing slug. Falls
 * back to Bulgarian, which is the site default and the right guess when
 * the URL itself is the thing that failed.
 */
export default function PublicNotFound() {
  const t = getDictionary(DEFAULT_LOCALE);

  return (
    <main id="main" className="property-section">
      <div className="container">
        <div className="property-not-found">
          <h1>{t.notFound.title}</h1>
          <p>{t.notFound.body}</p>
          <Link className="btn btn-brass" href={`/${DEFAULT_LOCALE}/lots`}>
            {t.notFound.cta}
          </Link>
        </div>
      </div>
    </main>
  );
}
