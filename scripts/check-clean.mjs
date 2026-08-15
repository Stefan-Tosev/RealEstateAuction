import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/*
 * Asserts the test suites left the database as they found it.
 *
 * Specs create data and are expected to remove it. When one does not, the
 * failure lands somewhere else entirely and much later: a lot left closed
 * by the worker spec broke a catalogue count assertion two files away, and
 * the time went on the innocent test rather than the guilty one.
 *
 * Cheap to run, so it runs on every CI pass rather than when somebody
 * suspects something.
 *
 * Run locally the same way: node scripts/check-clean.mjs
 */

const prisma = new PrismaClient();

/*
 * What the seed produces, and therefore what a clean database looks like.
 *
 * Status alone was not enough. extension_count is incremented by
 * place-bid.ts and was written by nothing else, so a lot bid into
 * extension kept the count for ever — and this script, whose whole claim
 * is "the database is as the seed left it", reported success while lot
 * 13 sat at 7 from a hand-run UPDATE. A guard that cannot see the state
 * it guards is worse than no guard, because it is believed.
 */
const EXPECTED_LOTS = {
  11: { status: "BIDDING_OPEN", extensionCount: 0 },
  12: { status: "BIDDING_OPEN", extensionCount: 0 },
  13: { status: "EXTENDING", extensionCount: 3 },
  14: { status: "PUBLISHED", extensionCount: 0 },
  15: { status: "PUBLISHED", extensionCount: 0 },
  16: { status: "CLOSED_SOLD", extensionCount: 0 },
  17: { status: "DRAFT", extensionCount: 0 },
};

/* Every prefix the suites use to mark their own rows. */
const TEST_PREFIXES = ["pw-", "vitest-", "shot-"];

const problems = [];

const users = await prisma.user.findMany({
  where: { OR: TEST_PREFIXES.map((prefix) => ({ email: { startsWith: prefix } })) },
  select: { email: true },
});
if (users.length > 0) {
  problems.push(`${users.length} test user(s) left behind: ${users.map((u) => u.email).join(", ")}`);
}

/*
 * Bids are append-only by trigger, so a leaked one cannot be tidied by
 * hand later — it needs the trigger disabled, which nothing in the
 * application can do. Worth catching immediately.
 */
const bids = await prisma.bid.count();
if (bids > 0) problems.push(`${bids} bid(s) left behind`);

for (const [model, label] of [
  [prisma.deposit, "deposit"],
  [prisma.bidderApproval, "bidder approval"],
  [prisma.outbox, "outbox message"],
  [prisma.viewingBooking, "viewing booking"],
  // Fees are billing records. One left behind by a spec is an invoice
  // for a sale that never happened.
  [prisma.fee, "fee"],
  // Sellers are personal data. One left behind by a spec is somebody's
  // name and telephone number sitting in a database for no reason.
  [prisma.seller, "seller"],
  // An invoice left behind is a used number in the sequence with nothing
  // to account for it — which is exactly what the numbering guards against.
  [prisma.invoice, "invoice"],
  // A leaked sale is a completion in progress against a lot nobody sold.
  [prisma.sale, "sale"],
]) {
  const count = await model.count();
  if (count > 0) problems.push(`${count} ${label}(s) left behind`);
}

const lots = await prisma.lot.findMany({
  select: { lotNumber: true, status: true, extensionCount: true },
  orderBy: { lotNumber: "asc" },
});

for (const lot of lots) {
  const expected = EXPECTED_LOTS[lot.lotNumber];
  if (!expected) {
    problems.push(`unexpected lot ${lot.lotNumber} — a spec created one and did not remove it`);
    continue;
  }

  if (lot.status !== expected.status) {
    problems.push(`lot ${lot.lotNumber} is ${lot.status}, seeded as ${expected.status}`);
  }

  if (lot.extensionCount !== expected.extensionCount) {
    problems.push(
      `lot ${lot.lotNumber} has extension_count ${lot.extensionCount}, seeded as ` +
        `${expected.extensionCount} — a spec bid it into extension and did not reset it`,
    );
  }
}

for (const lotNumber of Object.keys(EXPECTED_LOTS)) {
  if (!lots.some((lot) => lot.lotNumber === Number(lotNumber))) {
    problems.push(`seeded lot ${lotNumber} is missing`);
  }
}

await prisma.$disconnect();

if (problems.length > 0) {
  console.error("The suites did not leave the database as they found it:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nA leak passes today and breaks an unrelated spec tomorrow. Fix the cleanup\n" +
      "in whichever spec created the rows rather than tidying the database by hand.",
  );
  process.exit(1);
}

console.log("Database is as the seed left it.");
