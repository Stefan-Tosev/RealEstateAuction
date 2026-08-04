import { BCP47, type Locale } from "./locales";

/*
 * Derived meta on a lot card ("2 стаи", "65 кв.м", "Етаж 4") is built
 * from numeric columns, so the plural form has to be chosen in code.
 */

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const PLURAL_RULES: Record<Locale, Intl.PluralRules> = {
  bg: new Intl.PluralRules(BCP47.bg),
  en: new Intl.PluralRules(BCP47.en),
};

const NUMBER_FORMATS: Record<Locale, Intl.NumberFormat> = {
  bg: new Intl.NumberFormat(BCP47.bg),
  en: new Intl.NumberFormat(BCP47.en),
};

/** Substitute `{n}` with a locale-formatted number. */
export function interpolate(template: string, locale: Locale, n: number): string {
  return template.replace("{n}", NUMBER_FORMATS[locale].format(n));
}

/**
 * Pick the CLDR plural form for `n` and interpolate it.
 *
 * Both BG and EN have a two-form rule set (`one` for exactly 1, `other`
 * otherwise), so this is simple today — but going through Intl means a
 * locale with a real plural system (Russian, Polish) would work without
 * rewriting every call site.
 *
 * Known wrinkle: CLDR's `bg` `one` category is *exactly* 1, so 21 gives
 * "21 стаи" rather than the strictly grammatical "21 стая". A property
 * with 21 rooms is not a case worth hand-rolling around CLDR for.
 */
export function plural(locale: Locale, forms: PluralForms, n: number): string {
  const form = forms[PLURAL_RULES[locale].select(n)] ?? forms.other;
  return interpolate(form, locale, n);
}
