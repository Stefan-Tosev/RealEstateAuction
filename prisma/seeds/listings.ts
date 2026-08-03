import type { LotStatus, PropertyType } from "@prisma/client";

/*
 * Demo catalogue content.
 *
 * DELIBERATELY IMPORTS NOTHING but types. tests/e2e/catalogue.spec.ts
 * imports this file so its assertions and the seed cannot drift apart —
 * the exact failure mode CLAUDE.md documents for v1, where index.html
 * and the LISTINGS array in js/property.js were hand-kept in sync and
 * had already diverged.
 *
 * All seven lots are invented. The v1 prototype's six non-Bulgarian
 * listings (Big Sur, Joshua Tree, Camden ME) could not be carried over:
 * the schema requires bilingual titles and a Bulgarian city and region,
 * so "porting" them would have meant inventing Bulgarian copy anyway,
 * and a Bulgarian auction house with a Californian catalogue makes no
 * sense in a demo.
 *
 * Statuses are spread to exercise every UI path — including the DRAFT
 * lot, which exists solely so the e2e suite can prove the status
 * allowlist keeps it out of the index and 404s its URL.
 */

export type SeedImage = {
  /** Filename under public/media/properties/<slug>/ */
  file: string;
  altBg: string;
  altEn: string;
  width: number;
  height: number;
};

export type SeedListing = {
  slug: string;
  lotNumber: number;
  status: LotStatus;
  titleBg: string;
  titleEn: string;
  descriptionBg: string;
  descriptionEn: string;
  address: string;
  city: string;
  region: string;
  propertyType: PropertyType;
  rooms: number | null;
  areaSqm: number | null;
  floor: number | null;
  yearBuilt: number | null;
  startingPriceMinor: bigint;
  bidIncrementMinor: bigint;
  /*
   * Hours from seed time to the close. Negative means already closed.
   *
   * Stored as an offset rather than an absolute date on purpose: v1's
   * hardcoded closeDate values are all in the past now, so a fresh
   * catalogue would look dead and every e2e assertion about "closing
   * soon" would rot within a week of being written.
   */
  closesInHours: number;
  /** Which of v1's .lot-image-N gradients the placeholder was rendered from. */
  gradient: number;
  images: SeedImage[];
};

export const LISTINGS: SeedListing[] = [
  {
    slug: "dvustaen-karshiyaka-plovdiv",
    lotNumber: 11,
    status: "BIDDING_OPEN",
    titleBg: "Двустаен апартамент в Кършияка",
    titleEn: "Two-room apartment in Karshiyaka",
    descriptionBg:
      "Светъл двустаен апартамент в утвърден квартал на Пловдив, само на няколко минути от центъра. Обновена баня и кухня, PVC дограма и юг-изток изложение. Отличен вариант за живеене или отдаване под наем.",
    descriptionEn:
      "A bright two-room apartment in an established Plovdiv neighbourhood, minutes from the city centre. Renovated bathroom and kitchen, PVC joinery, and a south-east exposure. A strong option for owner-occupancy or rental income.",
    address: "ул. Съборна 14, Кършияка, Пловдив",
    city: "Пловдив",
    region: "Пловдив",
    propertyType: "apartment",
    rooms: 2,
    areaSqm: 65,
    floor: 4,
    yearBuilt: 1986,
    startingPriceMinor: 10_000_000n,
    bidIncrementMinor: 200_000n,
    // Inside the 48h urgency threshold — exercises [data-urgent].
    closesInHours: 30,
    gradient: 1,
    images: [
      {
        file: "01.jpg",
        altBg: "Фасадата на жилищната сграда в Кършияка",
        altEn: "The facade of the apartment building in Karshiyaka",
        width: 996,
        height: 814,
      },
    ],
  },
  {
    slug: "tristaen-lozenets-sofia",
    lotNumber: 12,
    status: "BIDDING_OPEN",
    titleBg: "Тристаен апартамент в Лозенец",
    titleEn: "Three-room apartment in Lozenets",
    descriptionBg:
      "Просторен тристаен апартамент в сърцето на Лозенец, с два паркоместа и голяма тераса към вътрешен двор. Тухлена сграда с асансьор, поддържана входна част и спокойна улица встрани от движението.",
    descriptionEn:
      "A spacious three-room apartment in the heart of Lozenets, with two parking spaces and a large terrace facing an inner courtyard. Brick building with a lift, a well-kept entrance, and a quiet street away from traffic.",
    address: "ул. Кричим 42, Лозенец, София",
    city: "София",
    region: "София",
    propertyType: "apartment",
    rooms: 3,
    areaSqm: 118,
    floor: 5,
    yearBuilt: 2004,
    startingPriceMinor: 34_500_000n,
    bidIncrementMinor: 500_000n,
    closesInHours: 96,
    gradient: 2,
    images: [
      {
        file: "01.jpg",
        altBg: "Дневната с изход към терасата",
        altEn: "The living room opening onto the terrace",
        width: 1600,
        height: 1200,
      },
      {
        file: "02.jpg",
        altBg: "Терасата с изглед към вътрешния двор",
        altEn: "The terrace overlooking the inner courtyard",
        width: 1600,
        height: 1200,
      },
    ],
  },
  {
    slug: "kashta-boyana-sofia",
    lotNumber: 13,
    status: "EXTENDING",
    titleBg: "Къща с двор в Бояна",
    titleEn: "House with garden in Boyana",
    descriptionBg:
      "Самостоятелна къща в подножието на Витоша, разположена в двор от 620 кв.м с оформена градина. Три нива, гараж за два автомобила и панорамен изглед към града от последния етаж.",
    descriptionEn:
      "A detached house at the foot of Vitosha, set in a 620 sqm plot with a mature garden. Three levels, a double garage, and a panoramic view over the city from the top floor.",
    address: "ул. Матей Преображенски 8, Бояна, София",
    city: "София",
    region: "София",
    propertyType: "house",
    rooms: 6,
    areaSqm: 310,
    floor: null,
    yearBuilt: 2011,
    startingPriceMinor: 89_000_000n,
    bidIncrementMinor: 1_000_000n,
    /*
     * Exercises the EXTENDING badge. Two hours, not minutes: there is no
     * soft-close engine until Phase 3, so nothing advances the status
     * when the clock runs out — a shorter window left the catalogue
     * showing an "extended" badge above a "closed" countdown within
     * minutes of seeding.
     */
    closesInHours: 2,
    gradient: 3,
    images: [
      {
        file: "01.jpg",
        altBg: "Къщата, гледана от градината",
        altEn: "The house seen from the garden",
        width: 1600,
        height: 1200,
      },
    ],
  },
  {
    slug: "mezonet-more-varna",
    lotNumber: 14,
    status: "PUBLISHED",
    titleBg: "Мезонет с изглед към морето",
    titleEn: "Maisonette with sea view",
    descriptionBg:
      "Мезонет на две нива в нова сграда над Морската градина, с директен изглед към залива. Обширна тераса, подово отопление и подземен паркинг. Продава се напълно обзаведен.",
    descriptionEn:
      "A two-level maisonette in a new building above the Sea Garden, with a direct view over the bay. A generous terrace, underfloor heating, and underground parking. Sold fully furnished.",
    address: "ул. Приморски 3, Варна",
    city: "Варна",
    region: "Варна",
    propertyType: "apartment",
    rooms: 4,
    areaSqm: 164,
    floor: 7,
    yearBuilt: 2021,
    startingPriceMinor: 52_000_000n,
    bidIncrementMinor: 1_000_000n,
    // Bidding opens in 9 days (close minus the 5-day bidding window).
    closesInHours: 24 * 14,
    gradient: 4,
    images: [
      {
        file: "01.jpg",
        altBg: "Терасата с изглед към залива",
        altEn: "The terrace overlooking the bay",
        width: 1600,
        height: 1200,
      },
    ],
  },
  {
    slug: "kashta-stariya-grad-plovdiv",
    lotNumber: 15,
    status: "PUBLISHED",
    titleBg: "Реновирана къща в Стария град",
    titleEn: "Restored house in the Old Town",
    descriptionBg:
      "Възрожденска къща в Стария град на Пловдив, реставрирана през 2019 г. с автентични дървени тавани и запазена каменна основа. Вътрешен двор с калдъръм и лятна кухня.",
    descriptionEn:
      "A National Revival house in Plovdiv's Old Town, restored in 2019 with original timber ceilings and its stone foundation preserved. A cobbled inner courtyard with a summer kitchen.",
    address: "ул. Съборна 27, Стария град, Пловдив",
    city: "Пловдив",
    region: "Пловдив",
    propertyType: "house",
    rooms: 5,
    areaSqm: 240,
    floor: null,
    yearBuilt: 1874,
    startingPriceMinor: 41_000_000n,
    bidIncrementMinor: 500_000n,
    closesInHours: 24 * 23,
    gradient: 5,
    images: [
      {
        file: "01.jpg",
        altBg: "Фасадата откъм калдъръмената улица",
        altEn: "The facade from the cobbled street",
        width: 1600,
        height: 1200,
      },
      {
        file: "02.jpg",
        altBg: "Вътрешният двор с лятната кухня",
        altEn: "The inner courtyard with the summer kitchen",
        width: 1600,
        height: 1200,
      },
    ],
  },
  {
    slug: "targovsko-vitosha-sofia",
    lotNumber: 16,
    status: "CLOSED_SOLD",
    titleBg: "Търговско помещение на бул. Витоша",
    titleEn: "Retail unit on Vitosha Boulevard",
    descriptionBg:
      "Партерно търговско помещение на пешеходната част на бул. Витоша, с витрина от 9 метра и складово помещение отзад. Действащ наемен договор до 2028 г.",
    descriptionEn:
      "A ground-floor retail unit on the pedestrian stretch of Vitosha Boulevard, with a nine-metre shopfront and storage to the rear. An existing lease runs to 2028.",
    address: "бул. Витоша 61, София",
    city: "София",
    region: "София",
    propertyType: "commercial",
    rooms: null,
    areaSqm: 95,
    floor: 0,
    yearBuilt: 1968,
    startingPriceMinor: 68_000_000n,
    bidIncrementMinor: 1_000_000n,
    // Closed five days ago: resolves by URL, absent from the index.
    closesInHours: -120,
    gradient: 6,
    images: [
      {
        file: "01.jpg",
        altBg: "Витрината откъм булеварда",
        altEn: "The shopfront from the boulevard",
        width: 1600,
        height: 1200,
      },
    ],
  },
  {
    slug: "partsel-pirin-bansko",
    lotNumber: 17,
    status: "DRAFT",
    titleBg: "Парцел с изглед към Пирин",
    titleEn: "Building plot with a Pirin view",
    descriptionBg:
      "Урегулиран поземлен имот от 1 400 кв.м в края на Банско, с одобрен проект за къща на две нива. Ток и вода на границата на имота.",
    descriptionEn:
      "A 1,400 sqm regulated plot on the edge of Bansko, with approved plans for a two-level house. Electricity and water at the boundary.",
    address: "местност Грамадето, Банско",
    city: "Банско",
    region: "Благоевград",
    propertyType: "land",
    rooms: null,
    areaSqm: 1400,
    floor: null,
    yearBuilt: null,
    startingPriceMinor: 14_000_000n,
    bidIncrementMinor: 250_000n,
    closesInHours: 24 * 30,
    gradient: 7,
    images: [
      {
        file: "01.jpg",
        altBg: "Парцелът с планината на заден план",
        altEn: "The plot with the mountain behind",
        width: 1600,
        height: 1200,
      },
    ],
  },
];

/** Shown in the index. Kept here so e2e assertions derive it, not hardcode it. */
export const LISTABLE_SEED_SLUGS = LISTINGS.filter((l) =>
  ["PUBLISHED", "BIDDING_OPEN", "EXTENDING"].includes(l.status),
).map((l) => l.slug);

/** Must 404 and must never appear in the index. */
export const DRAFT_SEED_SLUG = "partsel-pirin-bansko";
