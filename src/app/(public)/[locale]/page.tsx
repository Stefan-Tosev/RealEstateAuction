import { redirect } from "next/navigation";

/*
 * The catalogue is the whole public site this pass, so the landing page
 * is the lots index. A marketing homepage (hero lot, how-it-works,
 * stats band — all of which v1 has) is a later concern; sending visitors
 * straight to the listings beats a placeholder that says "coming soon".
 */
export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/lots`);
}
