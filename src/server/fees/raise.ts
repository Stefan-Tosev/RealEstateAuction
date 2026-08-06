import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fixedFee, percentFee } from "./calculate";
import {
  BUYER_PREMIUM_BPS,
  ENTRY_FEE_NET_MINOR,
  SELLER_COMMISSION_BPS,
  VAT_RATE_BPS,
  WITHDRAWAL_FIXED_NET_MINOR,
  bpsToRate,
} from "./schedule";

/*
 * Raising the fees a lot owes, at the moments §10 says they fall due.
 *
 * Idempotent at the database rather than by checking first: a close that
 * runs twice, a publish clicked twice, or two workers racing must not
 * produce two commissions. A duplicate is not an error — the fee being
 * there already is the correct end state.
 *
 * Every rate that was applied is copied onto the row. A fee raised at
 * today's ДДС still reconciles after the statute changes, and an invoice
 * reissued in a year shows what was actually charged.
 */

type Client = Prisma.TransactionClient;

/**
 * Insert unless the fee is already there.
 *
 * createMany with skipDuplicates, which Prisma compiles to ON CONFLICT
 * DO NOTHING — NOT a create() with the unique violation caught. Inside a
 * transaction those are not equivalent: a constraint violation aborts
 * the whole transaction in Postgres, so catching the error leaves every
 * statement after it failing on a dead transaction. Most of this runs
 * inside closeLot's, under the lot lock.
 *
 * Returns whether a row was written, so a caller can tell "raised" from
 * "already raised" without another query.
 */
async function insert(
  client: Client,
  data: Prisma.FeeUncheckedCreateInput,
): Promise<boolean> {
  const result = await client.fee.createMany({ data, skipDuplicates: true });
  return result.count > 0;
}

/**
 * Who the seller fees are owed by.
 *
 * Null is tolerated rather than thrown on: a lot cannot be PUBLISHED
 * without a seller, but withdrawal and commission can in principle be
 * raised against older data, and refusing to record a fee because the
 * counterparty is missing loses the fee as well as the name.
 */
async function sellerFor(lotId: string, client: Client): Promise<string | null> {
  const lot = await client.lot.findUnique({
    where: { id: lotId },
    select: { property: { select: { sellerId: true } } },
  });
  return lot?.property.sellerId ?? null;
}

/**
 * Charged when a lot is published, and non-refundable from that moment.
 *
 * Deliberately at publish rather than at close: §10's whole argument for
 * the entry fee is that it is "disclosed and charged BEFORE the lot goes
 * live, not levied as a penalty afterwards".
 */
export async function raiseEntryFee(lotId: string, client: Client = prisma): Promise<boolean> {
  const amount = fixedFee(ENTRY_FEE_NET_MINOR, VAT_RATE_BPS);

  return insert(client, {
    lotId,
    party: "seller",
    kind: "entry",
    sellerId: await sellerFor(lotId, client),
    basis: "fixed",
    netMinor: amount.netMinor,
    vatMinor: amount.vatMinor,
    vatRate: bpsToRate(VAT_RATE_BPS),
    chargedAt: new Date(),
  });
}

/**
 * The commission and the premium, raised together when a lot sells.
 *
 * Both are percentages of the hammer price — the amount actually bid,
 * not the reserve. A lot sold through the negotiation window sells below
 * its reserve, and charging on the reserve would bill the seller for a
 * price nobody paid.
 */
export async function raiseSaleFees(
  lotId: string,
  hammerMinor: bigint,
  buyerUserId: string | null,
  client: Client = prisma,
): Promise<void> {
  const commission = percentFee(hammerMinor, SELLER_COMMISSION_BPS, VAT_RATE_BPS);
  const premium = percentFee(hammerMinor, BUYER_PREMIUM_BPS, VAT_RATE_BPS);

  await insert(client, {
    lotId,
    party: "seller",
    kind: "commission",
    sellerId: await sellerFor(lotId, client),
    basis: "percent",
    rate: bpsToRate(SELLER_COMMISSION_BPS),
    baseMinor: hammerMinor,
    netMinor: commission.netMinor,
    vatMinor: commission.vatMinor,
    vatRate: bpsToRate(VAT_RATE_BPS),
    chargedAt: new Date(),
  });

  await insert(client, {
    lotId,
    party: "buyer",
    kind: "premium",
    userId: buyerUserId,
    basis: "percent",
    rate: bpsToRate(BUYER_PREMIUM_BPS),
    baseMinor: hammerMinor,
    netMinor: premium.netMinor,
    vatMinor: premium.vatMinor,
    vatRate: bpsToRate(VAT_RATE_BPS),
    chargedAt: new Date(),
  });
}

/**
 * Charged when a seller pulls a published lot: the entry fee again, plus
 * a fixed sum.
 *
 * Only for withdrawal. A seller refusing to complete a sale that MET the
 * reserve is not a fee matter — that sale is binding, the winning bidder
 * is the injured party, and it belongs to the contract rather than to
 * this table. A seller declining BELOW reserve owes nothing at all; §10
 * is explicit that an unmet reserve is not to be penalised.
 */
export async function raiseWithdrawalFee(
  lotId: string,
  client: Client = prisma,
): Promise<boolean> {
  const amount = fixedFee(ENTRY_FEE_NET_MINOR + WITHDRAWAL_FIXED_NET_MINOR, VAT_RATE_BPS);

  return insert(client, {
    lotId,
    party: "seller",
    kind: "withdrawal",
    sellerId: await sellerFor(lotId, client),
    basis: "fixed",
    netMinor: amount.netMinor,
    vatMinor: amount.vatMinor,
    vatRate: bpsToRate(VAT_RATE_BPS),
    chargedAt: new Date(),
    note: "Entry fee plus the fixed withdrawal sum.",
  });
}

export type FeeRow = {
  id: string;
  party: "seller" | "buyer";
  kind: "entry" | "commission" | "premium" | "withdrawal";
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  rate: string | null;
  status: string;
  chargedAt: Date | null;
};

/** Everything owed on a lot, for the admin. */
export async function listFeesForLot(lotId: string): Promise<FeeRow[]> {
  const fees = await prisma.fee.findMany({
    where: { lotId },
    orderBy: { chargedAt: "asc" },
  });

  return fees.map((fee) => ({
    id: fee.id,
    party: fee.party,
    kind: fee.kind,
    netMinor: fee.netMinor,
    vatMinor: fee.vatMinor,
    // Derived, never stored — net + vat is the only definition of gross.
    grossMinor: fee.netMinor + fee.vatMinor,
    rate: fee.rate ? fee.rate.toString() : null,
    status: fee.status,
    chargedAt: fee.chargedAt,
  }));
}
