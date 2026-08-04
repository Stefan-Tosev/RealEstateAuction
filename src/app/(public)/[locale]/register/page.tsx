import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { localeAlternates } from "@/lib/i18n/alternates";
import { isLocale } from "@/lib/i18n/locales";
import { issueFormToken } from "@/server/identity/form-token";
import { RegisterForm } from "./register-form";

/*
 * The form token is minted here, on the server, at render time. That is
 * what makes the §6 time gate real: a client-measured "seconds since
 * load" is the attacker's number to choose, whereas an HMAC-signed
 * timestamp is not.
 *
 * force-dynamic because of it — a cached page would hand every visitor
 * the same token, aged by however long the cache had held it.
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
    title: `${t.register.heading} — ${t.site.name}`,
    description: t.register.lede,
    alternates: localeAlternates(locale, "/register"),
  };
}

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = getDictionary(locale);

  return (
    <main id="main" className="auth-section">
      <div className="container auth-inner">
        <p className="eyebrow">{t.register.eyebrow}</p>
        <h1 className="section-title">{t.register.heading}</h1>
        <p className="section-lede">{t.register.lede}</p>

        <RegisterForm locale={locale} t={t} formToken={issueFormToken()} />
      </div>
    </main>
  );
}
