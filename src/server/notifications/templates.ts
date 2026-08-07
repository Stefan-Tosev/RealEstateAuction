import type { Locale } from "@/lib/i18n/locales";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";

/*
 * Email copy, in both languages.
 *
 * Rendered in the *recipient's* locale, taken from users.locale — not the
 * locale of whoever caused the message. A Bulgarian bidder outbid by an
 * English-speaking one gets Bulgarian.
 *
 * Plain text only, deliberately. These are transactional messages whose
 * whole job is a fact and a link; HTML buys nothing here and costs a
 * rendering surface, an escaping obligation, and a reliable trip to the
 * promotions tab. If marketing mail is ever added it can bring its own
 * renderer.
 *
 * Nothing here interpolates into markup, so there is no escaping to get
 * wrong. Amounts and dates are formatted by the same functions the site
 * uses, so an email and the page never disagree about what €345,000 or a
 * Sofia timestamp looks like.
 */

export type Rendered = { subject: string; text: string };

/**
 * What a template gets. `lot` is resolved by the dispatcher when the
 * payload carries a lotId, so copy can name the property rather than
 * saying "your lot".
 */
export type TemplateContext = {
  locale: Locale;
  baseUrl: string;
  payload: Record<string, unknown>;
  lot: { lotRef: string; slug: string; title: string } | null;
};

const str = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === "string" ? (payload[key] as string) : "";

function lotUrl(context: TemplateContext): string {
  return context.lot ? `${context.baseUrl}/${context.locale}/lots/${context.lot.slug}` : "";
}

function lotLine(context: TemplateContext): string {
  if (!context.lot) return "";
  return context.locale === "bg"
    ? `Лот ${context.lot.lotRef} — ${context.lot.title}`
    : `Lot ${context.lot.lotRef} — ${context.lot.title}`;
}

const SIGN_OFF = {
  bg: "\n\nAuction House\nhttps://auctionhouse.bg",
  en: "\n\nAuction House\nhttps://auctionhouse.bg",
} as const;

type Renderer = (context: TemplateContext) => Rendered;

const TEMPLATES: Record<string, Record<Locale, Renderer>> = {
  verify_email: {
    bg: (c) => ({
      subject: "Потвърдете имейл адреса си",
      text: `Здравейте,\n\nЗа да завършите регистрацията си, потвърдете адреса:\n\n${str(c.payload, "verifyUrl")}\n\nВръзката е валидна 24 часа и може да се използва само веднъж.\n\nАко не сте се регистрирали при нас, просто пренебрегнете това съобщение.${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: "Confirm your email address",
      text: `Hello,\n\nTo finish setting up your account, confirm your address:\n\n${str(c.payload, "verifyUrl")}\n\nThe link is valid for 24 hours and can be used once.\n\nIf you did not register with us, simply ignore this message.${SIGN_OFF.en}`,
    }),
  },

  /*
   * Sent to the holder of an address someone tried to register again.
   * It must never confirm or deny anything to the person who submitted
   * the form — §5 — which is why it goes to the address on file and
   * nowhere else, and says only what its genuine owner already knows.
   */
  registration_attempt_existing_account: {
    bg: (c) => ({
      subject: "Опит за регистрация с вашия адрес",
      text: `Здравейте,\n\nНякой опита да създаде профил с този имейл адрес. Вие вече имате профил при нас, така че нов не беше създаден.\n\nАко това бяхте вие, влезте оттук:\n${str(c.payload, "signInUrl")}\n\nАко не бяхте вие, не е нужно да правите нищо — никой не е получил достъп до профила ви.${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: "Someone tried to register with your address",
      text: `Hello,\n\nSomebody tried to create an account with this email address. You already have one, so no new account was created.\n\nIf that was you, sign in here:\n${str(c.payload, "signInUrl")}\n\nIf it was not you, there is nothing to do — nobody gained access to your account.${SIGN_OFF.en}`,
    }),
  },

  outbid: {
    bg: (c) => ({
      subject: `Наддадоха ви${c.lot ? ` — лот ${c.lot.lotRef}` : ""}`,
      text: `Здравейте,\n\n${lotLine(c)}\n\nДруг участник наддаде ${formatMoney(str(c.payload, "amountMinor") || "0", "bg")}. Вашата оферта вече не е водеща.\n\nНаддаването остава отворено, докато изминат пет минути без нова оферта — така че все още имате време:\n\n${lotUrl(c)}${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: `You have been outbid${c.lot ? ` — lot ${c.lot.lotRef}` : ""}`,
      text: `Hello,\n\n${lotLine(c)}\n\nAnother bidder has bid ${formatMoney(str(c.payload, "amountMinor") || "0", "en")}. Your bid is no longer the leading one.\n\nBidding stays open until five minutes pass with no new bid, so there is still time:\n\n${lotUrl(c)}${SIGN_OFF.en}`,
    }),
  },

  deposit_received: {
    bg: (c) => ({
      subject: "Депозитът ви е получен",
      text: `Здравейте,\n\nПотвърждаваме получаването на депозит от ${formatMoney(str(c.payload, "amountMinor") || "0", "bg")}.\n\n${lotLine(c)}\n\nВече можете да наддавате за този лот:\n${lotUrl(c)}${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: "Your deposit has been received",
      text: `Hello,\n\nWe confirm receipt of a deposit of ${formatMoney(str(c.payload, "amountMinor") || "0", "en")}.\n\n${lotLine(c)}\n\nYou can now bid on this lot:\n${lotUrl(c)}${SIGN_OFF.en}`,
    }),
  },

  deposit_released: {
    bg: (c) => ({
      subject: "Депозитът ви е освободен",
      text: `Здравейте,\n\nДепозитът ви от ${formatMoney(str(c.payload, "amountMinor") || "0", "bg")} е освободен и парите се връщат по същия път, по който постъпиха.\n\n${lotLine(c)}\n\nБлагодарим ви, че участвахте.${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: "Your deposit has been released",
      text: `Hello,\n\nYour deposit of ${formatMoney(str(c.payload, "amountMinor") || "0", "en")} has been released and is returning by the route it arrived.\n\n${lotLine(c)}\n\nThank you for taking part.${SIGN_OFF.en}`,
    }),
  },

  lot_won: {
    bg: (c) => ({
      subject: `Спечелихте${c.lot ? ` лот ${c.lot.lotRef}` : ""}`,
      text: `Поздравления,\n\n${lotLine(c)}\n\nВашата оферта от ${formatMoney(str(c.payload, "amountMinor") || "0", "bg")} е печелившата.\n\nЩе се свържем с вас с указания за плащането и документите.\n\n${lotUrl(c)}${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: `You have won${c.lot ? ` lot ${c.lot.lotRef}` : ""}`,
      text: `Congratulations,\n\n${lotLine(c)}\n\nYour bid of ${formatMoney(str(c.payload, "amountMinor") || "0", "en")} is the winning one.\n\nWe will be in touch with payment instructions and the paperwork.\n\n${lotUrl(c)}${SIGN_OFF.en}`,
    }),
  },

  /*
   * Not a loss. §1 gives the auctioneer a window to take the top bid to
   * the seller, and the copy must not read as a rejection — the bidder
   * may well still buy the property.
   */
  lot_reserve_not_met: {
    bg: (c) => ({
      subject: `Наддаването приключи${c.lot ? ` — лот ${c.lot.lotRef}` : ""}`,
      text: `Здравейте,\n\n${lotLine(c)}\n\nНаддаването приключи и вашата оферта от ${formatMoney(str(c.payload, "amountMinor") || "0", "bg")} е най-високата, но не достигна запазената цена.\n\nЩе я представим на продавача и ще се върнем при вас в рамките на няколко дни. Лотът все още може да стане ваш.${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: `Bidding has closed${c.lot ? ` — lot ${c.lot.lotRef}` : ""}`,
      text: `Hello,\n\n${lotLine(c)}\n\nBidding has closed and your bid of ${formatMoney(str(c.payload, "amountMinor") || "0", "en")} is the highest, but it did not reach the reserve.\n\nWe will put it to the seller and come back to you within a few days. The lot may still be yours.${SIGN_OFF.en}`,
    }),
  },

  lot_bid_log: {
    bg: (c) => ({
      subject: `Отчет за наддаването${c.lot ? ` — лот ${c.lot.lotRef}` : ""}`,
      text: `Здравейте,\n\n${lotLine(c)}\n\n${str(c.payload, "summary")}\n\nПълен списък на приетите оферти:\n\n${str(c.payload, "log")}\n\nУчастниците са номерирани, а не именувани. Не разкриваме самоличността на наддаващите — това ги защитава и запазва стойността на процеса за вас.\n\nЩе се свържем с вас за следващите стъпки.${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: `Bidding report${c.lot ? ` — lot ${c.lot.lotRef}` : ""}`,
      text: `Hello,\n\n${lotLine(c)}\n\n${str(c.payload, "summary")}\n\nEvery accepted bid, in order:\n\n${str(c.payload, "log")}\n\nBidders are numbered rather than named. We do not disclose who bid — that protects them, and it is what keeps the process worth taking part in.\n\nWe will be in touch about next steps.${SIGN_OFF.en}`,
    }),
  },

  viewing_booked: {
    bg: (c) => ({
      subject: "Записахте се за оглед",
      text: `Здравейте,\n\nЗапазено място за оглед на ${formatDateTime(str(c.payload, "startsAt"), "bg")}.\n\n${lotLine(c)}\n\nАко не можете да присъствате, моля отпишете се, за да освободите мястото:\n${lotUrl(c)}${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: "Your viewing is booked",
      text: `Hello,\n\nA place is reserved for the viewing on ${formatDateTime(str(c.payload, "startsAt"), "en")}.\n\n${lotLine(c)}\n\nIf you cannot attend, please cancel so the place goes to someone else:\n${lotUrl(c)}${SIGN_OFF.en}`,
    }),
  },

  viewing_cancelled_by_bidder: {
    bg: (c) => ({
      subject: "Отписахте се от оглед",
      text: `Здравейте,\n\nЗаписването ви за оглед е отменено и мястото е освободено.\n\n${lotLine(c)}\n\nМожете да се запишете отново по всяко време, ако има свободни места:\n${lotUrl(c)}${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: "Your viewing booking is cancelled",
      text: `Hello,\n\nYour viewing booking has been cancelled and the place released.\n\n${lotLine(c)}\n\nYou can book again at any time if places remain:\n${lotUrl(c)}${SIGN_OFF.en}`,
    }),
  },

  /*
   * The house cancelled, not the bidder. This one owes an apology and an
   * explicit next step, because somebody may have arranged their day
   * around it.
   */
  viewing_cancelled_by_house: {
    bg: (c) => ({
      subject: "Огледът е отменен",
      text: `Здравейте,\n\nСъжаляваме — огледът, за който бяхте записани, беше отменен от наша страна.\n\n${lotLine(c)}\n\nЩе обявим нови дати възможно най-скоро. Ще ги видите тук:\n${lotUrl(c)}${SIGN_OFF.bg}`,
    }),
    en: (c) => ({
      subject: "The viewing has been cancelled",
      text: `Hello,\n\nWe are sorry — the viewing you were booked onto has been cancelled at our end.\n\n${lotLine(c)}\n\nWe will announce new dates as soon as we can. They will appear here:\n${lotUrl(c)}${SIGN_OFF.en}`,
    }),
  },
};

/** Every template the system knows how to render. */
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * Render a queued message, or null if there is no such template.
 *
 * Null rather than a throw: an unknown template is a deployment mistake,
 * and it must not stop the dispatcher delivering everything queued
 * behind it.
 */
export function render(template: string, context: TemplateContext): Rendered | null {
  const byLocale = TEMPLATES[template];
  if (!byLocale) return null;
  return byLocale[context.locale](context);
}
