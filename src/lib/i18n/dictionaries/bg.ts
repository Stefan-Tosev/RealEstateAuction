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
  register: {
    eyebrow: "Регистрация",
    heading: "Създайте профил",
    lede: "Етап 1 от регистрацията. Документи за самоличност и доказване на средства се изискват по-късно, преди издаване на номер за наддаване.",
    accountType: "Тип профил",
    individual: "Физическо лице",
    company: "Юридическо лице",
    firstName: "Име",
    lastName: "Фамилия",
    email: "Имейл",
    phone: "Телефон",
    phoneHint: "Български или международен номер. Ще получите код за потвърждение.",
    dateOfBirth: "Дата на раждане",
    dateOfBirthHint: "Трябва да сте навършили 18 години.",
    companyName: "Наименование на фирмата",
    eik: "ЕИК / БУЛСТАТ",
    eikHint: "9 или 13 цифри.",
    vat: "ДДС номер (по желание)",
    password: "Парола",
    passwordHint: "Поне 12 знака. Може да използвате цяла фраза с интервали. Уверете се, че можете да я напишете на всяко устройство, от което ще влизате — включително на телефон без кирилица.",
    terms: "Съгласен съм с Общите условия и Политиката за поверителност.",
    marketing: "Искам да получавам известия за нови лотове.",
    submit: "Създай профил",
    submitting: "Изпращане…",
    haveAccount: "Вече имате профил?",
    signIn: "Влезте",
    sentHeading: "Проверете имейла си",
    sentBody: "Ако адресът може да се използва, изпратихме съобщение с връзка за потвърждение. Връзката е валидна 24 часа.",
  },
  verify: {
    heading: "Потвърждение на имейл",
    success: "Имейлът е потвърден. Вече можете да влезете.",
    alreadyUsed: "Тази връзка вече е използвана. Опитайте да влезете.",
    expired: "Връзката е изтекла. Регистрирайте се отново, за да получите нова.",
    unknown: "Невалидна връзка за потвърждение.",
    missing: "Липсва код за потвърждение.",
    signIn: "Към вход",
  },
  signIn: {
    heading: "Вход",
    email: "Имейл",
    password: "Парола",
    submit: "Влез",
    submitting: "Влизане…",
    failed: "Грешен имейл или парола, или профилът не е потвърден.",
    noAccount: "Нямате профил?",
    register: "Регистрирайте се",
  },
  errors: {
    REQUIRED: "Полето е задължително.",
    TOO_LONG: "Стойността е твърде дълга.",
    INVALID_VALUE: "Невалидна стойност.",
    INVALID_CHARS: "Съдържа непозволени знаци.",
    INVALID_FORMAT: "Невалиден формат.",
    CHECKSUM_FAILED: "Контролната сума не съвпада. Проверете цифрите.",
    FUTURE_DATE: "Датата е в бъдещето.",
    UNDERAGE: "Трябва да сте навършили 18 години.",
    IMPLAUSIBLE: "Датата изглежда невярна.",
    NOT_ACCEPTED: "Трябва да приемете Общите условия.",
    TOO_SHORT: "Паролата е твърде кратка (поне 12 знака).",
    CONTAINS_PERSONAL: "Паролата не трябва да съдържа името или имейла ви.",
    BREACHED: "Тази парола е компрометирана при изтичане на данни. Изберете друга.",
    RATE_LIMITED: "Твърде много опити. Опитайте отново по-късно.",
    FORM_EXPIRED: "Формулярът е изтекъл. Презаредете страницата.",
    UNKNOWN: "Нещо се обърка. Опитайте отново.",
  },
  pack: {
    heading: "Правен пакет",
    lede: "Документите по имота. Пълният пакет е достъпен за регистрирани потребители.",
    empty: "Документите за този лот още не са качени.",
    signInToDownload: "Влезте, за да изтеглите",
    approvalRequired: "Достъпно за одобрени наддаващи",
    download: "Изтегли",
    countOne: "{n} документ",
    countOther: "{n} документа",
    kinds: {
      title_deed: "Нотариален акт",
      sketch: "Скица",
      tax_valuation: "Данъчна оценка",
      encumbrances: "Удостоверение за тежести",
      floor_plan: "Разпределение",
      energy_cert: "Енергиен сертификат",
      other: "Друг документ",
    },
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
