/*
 * Bulgarian is the source of truth: `Dictionary` is derived from this
 * object, so en.ts is checked against it and a missing key is a compile
 * error rather than a runtime `undefined` rendered into the page.
 *
 * This holds UI chrome only. Listing copy (titles, descriptions) comes
 * from the database as title_bg/title_en columns.
 */
export const bg = {
  site: {
    name: "Auction House",
    tagline: "Търгове за недвижими имоти",
    skipToContent: "Към съдържанието",
  },
  nav: {
    lots: "Лотове",
    howItWorks: "Как работи",
    openMenu: "Отвори менюто",
    closeMenu: "Затвори менюто",
    switchToOther: "English",
    switchLabel: "Смени езика на английски",
    themeToLight: "Светла тема",
    themeToDark: "Тъмна тема",
  },
  lots: {
    heading: "Текущи лотове",
    eyebrow: "Каталог",
    count: { one: "{n} лот", other: "{n} лота" },
    empty: "В момента няма активни лотове.",
    emptyHint: "Върнете се скоро — нови лотове се публикуват редовно.",
  },
  lot: {
    chip: "ЛОТ",
    viewLot: "Виж лот {n}",
    openingBid: "Начална оферта",
    currentBid: "Текуща оферта",
    closesIn: "Приключва след",
    biddingOpensIn: "Наддаването отваря след",
    closed: "Приключил",
    biddingClosed: "Наддаването приключи",
    badgePreview: "Предварителен преглед",
    badgeClosingSoon: "Скоро приключва",
    badgeExtending: "Удължено",
    // Derived from numeric columns, so the plural form is chosen in code.
    rooms: { one: "{n} стая", other: "{n} стаи" },
    areaSqm: "{n} кв.м",
    floor: "Етаж {n}",
    yearBuilt: "Построена {n}",
  },
  detail: {
    backToLots: "Назад към лотовете",
    description: "Описание",
    location: "Локация",
    keyDetails: "Основни данни",
    mapPlaceholder: "Тук ще бъде вградена карта",
    similar: "Подобни обекти",
    keyDates: "Важни дати",
    previewFrom: "Предварителен преглед от",
    biddingOpens: "Наддаването отваря",
    scheduledClose: "Планиран край",
    closedOn: "Приключил на",
    // No bid CTA this pass — bidding is Phase 3 and registration is
    // Phase 2, so there is nothing honest to link to.
    biddingOpensNote: "Наддаването отваря на {date}.",
    biddingClosedNote: "Наддаването за този лот приключи.",
    increment: "Стъпка на наддаване: {amount}",
  },
  propertyType: {
    apartment: "Апартамент",
    house: "Къща",
    land: "Парцел",
    commercial: "Търговски имот",
    other: "Друго",
  },
  notFound: {
    title: "Лотът не е намерен",
    body: "Този лот не съществува или вече не е публичен.",
    cta: "Виж всички лотове",
  },
  footer: {
    rights: "Всички права запазени.",
  },
} as const;

/*
 * `as const` above gives every string a literal type, which is what we
 * want for autocomplete but not for the contract other locales satisfy —
 * `en.site.name` must be assignable to `string`, not to the literal
 * "Auction House". Widen the leaves, keep the shape.
 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Dictionary = Widen<typeof bg>;
