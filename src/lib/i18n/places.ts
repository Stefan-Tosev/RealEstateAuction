import type { Locale } from "./locales";

/*
 * `properties.city` and `properties.region` are single-language columns
 * (docs/architecture.md §2), so an English page would otherwise render
 * "Пловдив". Rather than widen the schema outside this pass's scope,
 * translate at display time through a closed lookup.
 *
 * This is tractable precisely because the set is closed: Bulgaria has 28
 * oblasts and the MVP catalogue will name maybe thirty settlements. The
 * fallback returns the stored value, so an unknown place renders in
 * Bulgarian rather than breaking the page.
 *
 * If the catalogue ever needs free-text places, add `city_en`/`region_en`
 * columns and delete this file.
 */

const PLACES: Record<string, Record<Locale, string>> = {
  София: { bg: "София", en: "Sofia" },
  Пловдив: { bg: "Пловдив", en: "Plovdiv" },
  Варна: { bg: "Варна", en: "Varna" },
  Бургас: { bg: "Бургас", en: "Burgas" },
  Русе: { bg: "Русе", en: "Ruse" },
  "Стара Загора": { bg: "Стара Загора", en: "Stara Zagora" },
  Плевен: { bg: "Плевен", en: "Pleven" },
  Сливен: { bg: "Сливен", en: "Sliven" },
  Добрич: { bg: "Добрич", en: "Dobrich" },
  Шумен: { bg: "Шумен", en: "Shumen" },
  Банско: { bg: "Банско", en: "Bansko" },
  Созопол: { bg: "Созопол", en: "Sozopol" },
  Несебър: { bg: "Несебър", en: "Nesebar" },
  Благоевград: { bg: "Благоевград", en: "Blagoevgrad" },
  "Велико Търново": { bg: "Велико Търново", en: "Veliko Tarnovo" },
};

export function placeName(stored: string, locale: Locale): string {
  return PLACES[stored]?.[locale] ?? stored;
}

/** "Кършияка, Пловдив" — the card's one-line location. */
export function locationLine(city: string, region: string, locale: Locale): string {
  const cityName = placeName(city, locale);
  const regionName = placeName(region, locale);
  return cityName === regionName ? cityName : `${cityName}, ${regionName}`;
}
