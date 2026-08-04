import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { localeAlternates } from "@/lib/i18n/alternates";
import { isLocale } from "@/lib/i18n/locales";
import { SignInForm } from "./sign-in-form";

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
    title: `${t.signIn.heading} — ${t.site.name}`,
    alternates: localeAlternates(locale, "/sign-in"),
  };
}

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = getDictionary(locale);

  return (
    <main id="main" className="auth-section">
      <div className="container auth-inner narrow">
        <h1 className="section-title">{t.signIn.heading}</h1>
        <SignInForm locale={locale} t={t} />
      </div>
    </main>
  );
}
