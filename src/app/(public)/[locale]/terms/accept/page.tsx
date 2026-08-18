import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDictionary } from "@/lib/i18n";
import { localeAlternates } from "@/lib/i18n/alternates";
import { isLocale } from "@/lib/i18n/locales";
import { currentBidder } from "@/server/identity/authz";
import { POLICY_VERSION, hasAcceptedCurrentTerms } from "@/server/identity/terms";
import { safeReturnTo } from "@/lib/safe-return-to";
import { TermsAcceptForm } from "@/components/terms-accept-form";

/*
 * Where a bidder accepts a revised set of terms.
 *
 * placeBid refuses anyone whose latest granted consent names an older
 * version, which without this page is a gate with no door: the moment
 * POLICY_VERSION moves, every existing bidder is locked out of bidding
 * with nothing they can do about it.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = getDictionary(locale);
  return {
    title: `${t.termsAccept.heading} — ${t.site.name}`,
    alternates: localeAlternates(locale, "/terms/accept"),
    /* Nothing to index: it is a one-off action page behind a session. */
    robots: { index: false, follow: false },
  };
}

export default async function AcceptTermsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { returnTo } = await searchParams;
  const t = getDictionary(locale);
  const back = safeReturnTo(returnTo, locale);

  const bidder = await currentBidder();
  if (!bidder) {
    redirect(`/${locale}/sign-in?returnTo=${encodeURIComponent(`/${locale}/terms/accept`)}`);
  }

  const upToDate = await hasAcceptedCurrentTerms(prisma, bidder.id);

  return (
    <main id="main" className="auth-section">
      <div className="container auth-inner narrow">
      <h1 className="section-title">{t.termsAccept.heading}</h1>

      {upToDate ? (
        <>
          <p className="form-notice">{t.termsAccept.alreadyAccepted}</p>
          <p>
            <Link className="btn btn-brass btn-lg btn-full" href={back}>
              {t.termsAccept.continue}
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="form-notice">{t.termsAccept.intro}</p>

          {/*
           * The terms themselves. Today this is a placeholder naming the
           * version, because the real document does not exist yet — the
           * lawyer's text drops in here and POLICY_VERSION moves with it.
           * Deliberately not hidden behind a link: consent to something
           * you were not shown is not consent.
           */}
          <section className="form-card" aria-label={t.termsAccept.heading}>
            <p className="field-hint">
              {t.termsAccept.version.replace("{version}", POLICY_VERSION)}
            </p>
            <p>{t.termsAccept.placeholder}</p>
          </section>

          <TermsAcceptForm
            locale={locale}
            wording={t.termsAccept.checkbox}
            returnTo={back}
            copy={{
              submit: t.termsAccept.submit,
              errorNotTicked: t.termsAccept.errorNotTicked,
              signin: t.termsAccept.signin,
              accepted: t.termsAccept.accepted,
            }}
          />

          <p className="form-footer">
            <Link href={back}>{t.termsAccept.back}</Link>
          </p>
        </>
      )}
      </div>
    </main>
  );
}
