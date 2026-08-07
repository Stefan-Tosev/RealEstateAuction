import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";
import type { Locale } from "@/lib/i18n/locales";
import { enqueue } from "@/server/notifications/outbox";
import { bidLogForLot, type BidLog } from "./bid-log";

/*
 * Sending the seller their bid log once a lot has finished.
 *
 * Rendered here rather than in the template because the log is a table
 * of money and timestamps, and both have exactly one place they may be
 * formatted — src/lib/money.ts and src/lib/datetime.ts. A template
 * building its own would eventually disagree with the site about what
 * €345,000 or a Sofia timestamp looks like.
 */

type Client = Prisma.TransactionClient;

/** The one-line verdict, before the detail. */
function summaryLine(log: BidLog, status: string, locale: Locale): string {
  const top = log.entries.at(-1);

  if (!top) {
    return locale === "bg"
      ? "Наддаването приключи без нито една оферта."
      : "Bidding closed without a single bid.";
  }

  const price = formatMoney(top.amountMinor, locale);
  const people = log.bidderCount;

  if (status === "CLOSED_SOLD") {
    return locale === "bg"
      ? `Лотът е продаден за ${price}, след ${log.entries.length} оферти от ${people} участници.`
      : `The lot sold for ${price}, after ${log.entries.length} bids from ${people} bidders.`;
  }

  if (status === "RESERVE_NOT_MET") {
    return locale === "bg"
      ? `Най-високата оферта е ${price}, от ${people} участници, но не достигна запазената цена. Ще се свържем с вас, за да я обсъдим.`
      : `The highest bid was ${price}, from ${people} bidders, but it did not reach your reserve. We will be in touch to discuss it.`;
  }

  return locale === "bg"
    ? `Най-високата оферта е ${price}, от ${people} участници. Лотът остана непродаден.`
    : `The highest bid was ${price}, from ${people} bidders. The lot did not sell.`;
}

function renderLog(log: BidLog, locale: Locale): string {
  if (log.entries.length === 0) return locale === "bg" ? "(няма оферти)" : "(no bids)";

  const bidder = locale === "bg" ? "Наддаващ" : "Bidder";
  const extended = locale === "bg" ? "удължи срока" : "extended the clock";

  return log.entries
    .map((entry) => {
      const line = `${bidder} ${entry.bidderIndex} — ${formatMoney(entry.amountMinor, locale)} — ${formatDateTime(entry.at, locale)}`;
      return entry.extendedClock ? `${line} (${extended})` : line;
    })
    .join("\n");
}

/**
 * Queue the report, if there is a seller to send it to.
 *
 * Silent when the property has no seller recorded. A lot cannot be
 * PUBLISHED without one, so in practice this only happens to data
 * predating that gate — and a missing report is not worth failing a
 * close over, which is the transaction that decides who owns a property.
 */
export async function sendBidLogToSeller(
  lotId: string,
  status: string,
  client: Client = prisma,
): Promise<boolean> {
  const lot = await client.lot.findUnique({
    where: { id: lotId },
    select: { property: { select: { sellerId: true, seller: { select: { locale: true } } } } },
  });

  const sellerId = lot?.property.sellerId;
  if (!sellerId) return false;

  const locale = (lot.property.seller?.locale ?? "bg") as Locale;
  const log = await bidLogForLot(lotId);

  await enqueue(
    {
      sellerId,
      channel: "email",
      template: "lot_bid_log",
      payload: {
        lotId,
        summary: summaryLine(log, status, locale),
        log: renderLog(log, locale),
      },
    },
    client,
  );

  return true;
}
