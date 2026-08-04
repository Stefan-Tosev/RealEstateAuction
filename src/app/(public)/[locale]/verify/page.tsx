import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n/locales";
import { redeemVerificationToken } from "@/server/identity/verification";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // A verification link is single-use and personal; it has no business
  // in a search index.
  robots: { index: false, follow: false },
};

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { token } = await searchParams;
  const t = getDictionary(locale);

  const outcome = token ? await redeemVerificationToken(token) : null;

  const message = !token
    ? t.verify.missing
    : outcome?.ok
      ? t.verify.success
      : outcome?.reason === "already_used"
        ? t.verify.alreadyUsed
        : outcome?.reason === "expired"
          ? t.verify.expired
          : t.verify.unknown;

  const succeeded = Boolean(outcome?.ok);

  return (
    <main id="main" className="auth-section">
      <div className="container auth-inner narrow">
        <div className="auth-result">
          <h1>{t.verify.heading}</h1>
          <p data-testid="verify-message" data-ok={succeeded ? "true" : "false"}>
            {message}
          </p>
          <Link
            className={succeeded ? "btn btn-brass" : "btn btn-outline"}
            href={`/${locale}/sign-in`}
          >
            {t.verify.signIn}
          </Link>
        </div>
      </div>
    </main>
  );
}
