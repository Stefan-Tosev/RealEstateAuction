import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient, type LotStatus } from "@prisma/client";
// Relative, not the "@/" alias: no other e2e spec uses it, so its
// resolution under Playwright is unproven and this is not the change
// to find that out in.
import { POLICY_VERSION } from "../../src/server/identity/terms";

/*
 * Bidding from the browser, and the worker that closes lots.
 *
 * The engine itself is covered by unit tests against a real database;
 * what is only testable here is the chain — that the panel shows the
 * right state to each kind of viewer, that a bid placed through the form
 * actually lands, that a repeat submission does not become a second bid,
 * and that identities stay out of the public history.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const SLUG = "tristaen-lozenets-sofia";
const PREVIEW_SLUG = "mezonet-more-varna";
const PREFIX = "pw-bid-";
const APPROVED_EMAIL = `${PREFIX}approved@example.bg`;
const PENDING_EMAIL = `${PREFIX}pending@example.bg`;
const RIVAL_EMAIL = `${PREFIX}rival@example.bg`;
const PASSWORD = "granite harbour lantern fold";

let lotId = "";
let approvedId = "";
let rivalId = "";

/** The same formatting the page uses, so button names can be asserted. */
function eur(minor: bigint): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: minor % 100n === 0n ? 0 : 2,
    maximumFractionDigits: minor % 100n === 0n ? 0 : 2,
  }).format(Number(minor) / 100);
}
/** Restored in afterAll so the seeded catalogue is left as it was found. */
let originalCloseAt: Date | null = null;
/*
 * The worker tests close whatever is genuinely due, which can include a
 * seeded lot that aged past its clock. Snapshotting every lot and putting
 * them back is the only way this spec can promise it leaves the catalogue
 * as it found it — other specs assert on how many lots are listable.
 */
let lotSnapshot: { id: string; status: LotStatus; closedAt: Date | null }[] = [];

async function cleanup() {
  // Bids are append-only by database trigger — the guarantee the whole
  // audit trail rests on. Test data is the one thing allowed past it.
  await prisma.$executeRawUnsafe("ALTER TABLE bids DISABLE TRIGGER bids_append_only");
  try {
    await prisma.bid.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE bids ENABLE TRIGGER bids_append_only");
  }
  await prisma.bidderApproval.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

async function signIn(page: Page, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/lots$/);
}

test.beforeAll(async () => {
  await cleanup();

  lotSnapshot = await prisma.lot.findMany({ select: { id: true, status: true, closedAt: true } });

  const argon2 = await import("@node-rs/argon2");
  const passwordHash = await argon2.hash(PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const base = {
    passwordHash,
    firstName: "Мария",
    lastName: "Иванова",
    dateOfBirth: new Date("1988-04-11"),
    accountType: "individual" as const,
    emailVerifiedAt: new Date(),
    /*
     * What registration leaves behind, and placeBid now requires: a
     * granted terms consent naming the version in force. Without it
     * these bidders are refused before the amount is ever read, and
     * every assertion downstream measures the wrong refusal.
     */
    consents: {
      create: [
        {
          kind: "terms" as const,
          granted: true,
          policyVersion: POLICY_VERSION,
          wording: "Приемам общите условия.",
        },
      ],
    },
  };

  const approved = await prisma.user.create({
    data: { ...base, email: APPROVED_EMAIL },
    select: { id: true },
  });
  approvedId = approved.id;
  await prisma.bidderApproval.create({
    data: { userId: approvedId, status: "approved", reviewedAt: new Date() },
  });

  await prisma.user.create({ data: { ...base, email: PENDING_EMAIL, lastName: "Чакаща" } });

  const rival = await prisma.user.create({
    data: { ...base, email: RIVAL_EMAIL, firstName: "Георги", lastName: "Съперник" },
    select: { id: true },
  });
  rivalId = rival.id;
  await prisma.bidderApproval.create({
    data: { userId: rivalId, status: "approved", reviewedAt: new Date() },
  });

  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: SLUG } },
    orderBy: { lotNumber: "desc" },
    select: { id: true, effectiveCloseAt: true },
  });
  lotId = lot.id;
  originalCloseAt = lot.effectiveCloseAt;

  /*
   * Well clear of the soft-close window, so a bid placed by these tests
   * does not extend the clock and change what the assertions expect.
   */
  await prisma.lot.update({
    where: { id: lotId },
    data: {
      status: "BIDDING_OPEN",
      depositRequiredMinor: null,
      effectiveCloseAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    },
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.lot.update({
    where: { id: lotId },
    data: { status: "BIDDING_OPEN", effectiveCloseAt: originalCloseAt },
  });

  /*
   * Only the lots the worker actually moved. Rewriting every row would
   * also clear winningBidId on lots that legitimately have one, which is
   * a worse mess than the one this is cleaning up.
   */
  const now = await prisma.lot.findMany({ select: { id: true, status: true } });
  const statusNow = new Map(now.map((lot) => [lot.id, lot.status]));
  for (const lot of lotSnapshot) {
    if (statusNow.get(lot.id) === lot.status) continue;
    await prisma.lot.update({
      where: { id: lot.id },
      // The winning bid pointed at a bid the cleanup above removed.
      data: { status: lot.status, closedAt: lot.closedAt, winningBidId: null },
    });
  }

  await prisma.$disconnect();
});

test.describe("what the panel offers each viewer", () => {
  test("asks an anonymous visitor to sign in, and shows no form", async ({ page }) => {
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByRole("link", { name: "Sign in to bid" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bid / })).toHaveCount(0);
  });

  test("tells an unapproved bidder what is missing, not just 'no'", async ({ page }) => {
    await signIn(page, PENDING_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByText(/awaiting approval/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bid / })).toHaveCount(0);
  });

  test("offers nothing to bid on during the preview", async ({ page }) => {
    /*
     * A PUBLISHED lot is a preview — bidding has not opened. The absence
     * of any bid affordance is the point, not an omission.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${PREVIEW_SLUG}`);

    await expect(page.getByText("Bidding is not open for this lot.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bid / })).toHaveCount(0);
  });
});

test.describe("placing a bid", () => {
  test("offers one button carrying the exact next bid, and no field", async ({ page }) => {
    /*
     * There is nothing to type. Exactly one amount is valid, so a text
     * box could only ever add ways to get it wrong — and the way it went
     * wrong was an extra zero on something legally binding.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bid €345,000" })).toBeVisible();
    await expect(page.getByText("Bidding moves in fixed steps of €10,000.")).toBeVisible();
  });

  test("tells a bidder about the premium before they commit to anything", async ({ page }) => {
    /*
     * The premium is billed against the winning bidder, and for a while
     * it appeared on no public page at all. A fee somebody was never
     * shown is a consumer-protection problem before it is a trust one,
     * so this asserts it is visible at the moment of commitment rather
     * than only in the terms.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    // Beside the standing price.
    await expect(page.getByText("+3% buyer's premium").first()).toBeVisible();

    // And the actual sum, under the button that commits them.
    await expect(
      page.getByText(/Plus €10,350 buyer's premium \(3%, ДДС included\) — €355,350 in total/),
    ).toBeVisible();
  });

  test("discloses it on the index and in Bulgarian too", async ({ page }) => {
    await page.goto("/bg/lots");
    await expect(page.getByText("+3% комисиона за купувача").first()).toBeVisible();

    await page.goto(`/bg/lots/${SLUG}`);
    await expect(page.getByText(/Купувачът дължи комисиона от 3%/)).toBeVisible();
  });

  test("refuses an amount that is not the step, and records the refusal", async ({ page }) => {
    /*
     * Only a crafted request can reach this, which is exactly why it is
     * worth recording. §3: rejected bids are stored too, because an audit
     * needs to see what was attempted rather than only what succeeded.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    /*
     * Rewritten in flight rather than by setting the input's value.
     *
     * The amount is a CONTROLLED React input (components/bid-form.tsx),
     * so assigning to .value goes behind React's back and holds only
     * until the next render. Whether one happens before the click
     * differs between dev and production — this test failed every dev
     * run and passed every CI run, which meant it was reporting the
     * build mode rather than the behaviour.
     *
     * Intercepting is also the truer test. The threat is a client that
     * sends an amount the page never offered, which is exactly what this
     * produces, and it does not depend on React's state at all.
     */
    const onStep = 34_500_000n; // what the button actually displays
    const crafted = 150_000_000n; // a jump nothing on the page offers

    await page.route(`**/en/lots/${SLUG}`, async (route) => {
      const request = route.request();
      const body = request.method() === "POST" ? request.postData() : null;
      if (!body) return route.fallback();

      await route.continue({ postData: body.replace(String(onStep), String(crafted)) });
    });

    await page.getByRole("button", { name: /^Bid / }).click();

    await expect(page.getByText("Bids must be exactly the next step.")).toBeVisible();

    const rejected = await prisma.bid.findFirst({
      where: { lotId, userId: approvedId, status: "rejected" },
    });
    expect(rejected).not.toBeNull();
    expect(rejected!.rejectReason).toBe("NOT_ON_STEP");
    expect(rejected!.amountMinor).toBe(150_000_000n);
  });

  test("accepts the step and counts it", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    // The first bid is AT the guide price, not a step above it.
    await page.getByRole("button", { name: "Bid €345,000" }).click();

    await expect(page.getByText("Your bid was accepted.")).toBeVisible();
    await expect(page.getByText("1 bid", { exact: false })).toBeVisible();

    const accepted = await prisma.bid.findMany({
      where: { lotId, userId: approvedId, status: "accepted" },
    });
    expect(accepted).toHaveLength(1);
  });

  test("shows the history without saying who bid", async ({ page }) => {
    /*
     * Viewed by the RIVAL, not by the bidder themselves.
     *
     * That is the threat: a rival or a seller who can tell who they are
     * bidding against can approach them directly, and that is the
     * disclosure which causes actual harm. Signing in as the bidder made
     * the assertion incoherent — a page you are signed into legitimately
     * carries your own session, and in dev that session is serialised
     * into the RSC payload, so the test failed every dev run and passed
     * every CI run without the behaviour differing at all.
     */
    await signIn(page, RIVAL_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByText("Recent bids")).toBeVisible();
    await expect(page.getByText("Bidder 1")).toBeVisible();

    // Nothing anywhere in the document identifies who placed the bids.
    const html = await page.content();
    expect(html).not.toContain(APPROVED_EMAIL);
    expect(html).not.toContain("Иванова");

    // And the history itself names nobody at all, pseudonym aside.
    const history = await page.locator(".bid-history").innerText();
    expect(history).not.toContain("@");
    expect(history).toContain("Bidder 1");

    /*
     * The bidder's opaque id, which getBiddingView maps away to a
     * bidderIndex. Worth asserting separately from the email: a refactor
     * that passed raw bid rows to a client component would leak the id
     * and correlate a bidder across every lot they touch, while the
     * email assertion above stayed green.
     *
     * Production only. `next dev` serialises the server component's own
     * Prisma rows into the RSC payload — recognisable by React's $n and
     * $D markers for bigint and Date, which the mapped view never
     * produces — and none of that reaches a production build. Asserting
     * it in dev would report the build mode rather than the behaviour,
     * which is the trap the two fixes in this file were both about.
     */
    if (test.info().config.metadata.mode === "prod") {
      expect(html).not.toContain(approvedId);
    }
  });

  test("does not turn a repeat submission into a second bid", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    const before = await prisma.bid.count({ where: { lotId, status: "accepted" } });

    /*
     * Two clicks on one rendered form carry the same idempotency key, so
     * the second returns the first bid rather than placing another. This
     * is the failure that costs a bidder real money.
     */
    const button = page.getByRole("button", { name: /^Bid / });
    await button.click({ noWaitAfter: true });
    await button.click({ noWaitAfter: true, force: true }).catch(() => {
      // Fine — React may already have disabled it, which is the same
      // protection by a different route.
    });
    await expect(page.getByText(/accepted|bid that amount first/i)).toBeVisible();

    const after = await prisma.bid.count({ where: { lotId, status: "accepted" } });
    expect(after).toBe(before + 1);
  });

  test("still allows a genuine second bid afterwards", async ({ page }) => {
    /*
     * The other half of idempotency, and the easier one to break: a key
     * that never changes would silently replay the first bid forever,
     * and the bidder would watch their raise do nothing.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    const before = await prisma.bid.count({ where: { lotId, status: "accepted" } });

    await page.getByRole("button", { name: /^Bid / }).click();
    await expect(page.getByText(/Your bid was accepted/)).toBeVisible();

    const after = await prisma.bid.count({ where: { lotId, status: "accepted" } });
    expect(after).toBe(before + 1);
  });

  test("climbs exactly one step per bid, in both locales", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/bg/lots/${SLUG}`);

    const before = await prisma.bid.aggregate({
      where: { lotId, status: "accepted" },
      _max: { amountMinor: true },
    });

    await page.getByRole("button", { name: /^Наддай / }).click();
    await expect(page.getByText("Офертата ви е приета.")).toBeVisible();

    const after = await prisma.bid.aggregate({
      where: { lotId, status: "accepted" },
      _max: { amountMinor: true },
    });

    // €345,000 sits in the €10,000 band.
    expect(after._max.amountMinor! - before._max.amountMinor!).toBe(1_000_000n);
  });

  test("never puts the reserve in the page", async ({ page }) => {
    const lot = await prisma.lot.findUniqueOrThrow({
      where: { id: lotId },
      select: { reservePriceMinor: true },
    });
    await signIn(page, APPROVED_EMAIL);
    const response = await page.goto(`/en/lots/${SLUG}`);
    const body = (await response!.text()) ?? "";

    // Bounded by digit boundaries — a bare substring matches float noise
    // in the dev payload and fails for the wrong reason.
    expect(body).not.toMatch(new RegExp(`(?<!\\d)${lot.reservePriceMinor}(?!\\d)`));
  });
});

test.describe("the page keeps itself current", () => {
  test("the pulse reports the lot without leaking anything private", async ({ request }) => {
    const response = await request.get(`/api/lots/${lotId}/pulse`);
    expect(response.ok()).toBe(true);
    // Never cached: a stale pulse reports a lot as quiet while bids land,
    // which is the one thing it exists to catch.
    expect(response.headers()["cache-control"]).toContain("no-store");

    const pulse = await response.json();
    expect(pulse.status).toBe("BIDDING_OPEN");
    expect(typeof pulse.bidCount).toBe("number");

    /*
     * Unauthenticated, so it must carry nothing a visitor cannot already
     * read on the page — and above all not the reserve.
     */
    const lot = await prisma.lot.findUniqueOrThrow({
      where: { id: lotId },
      select: { reservePriceMinor: true },
    });
    const body = JSON.stringify(pulse);
    expect(body).not.toMatch(new RegExp(`(?<!\d)${lot.reservePriceMinor}(?!\d)`));
    expect(Object.keys(pulse).sort()).toEqual(["bidCount", "closeAtIso", "currentMinor", "status"]);
  });

  test("is 404 for a lot that does not exist", async ({ request }) => {
    const response = await request.get(
      "/api/lots/00000000-0000-0000-0000-000000000000/pulse",
    );
    expect(response.status()).toBe(404);
  });

  test("shows a rival's bid without the page being reloaded", async ({ page, browser }) => {
    /*
     * The reason §4 exists. One bidder sits on the lot page; another
     * bids from elsewhere; the first must see the new price without
     * touching anything, or an open-ended close only protects whoever
     * happens to be refreshing.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    const before = await prisma.bid.aggregate({
      where: { lotId, status: "accepted" },
      _max: { amountMinor: true },
    });
    const current = before._max.amountMinor!;

    // A second bidder, in a separate browser context entirely.
    const rival = await browser.newContext();
    const rivalPage = await rival.newPage();
    await signIn(rivalPage, RIVAL_EMAIL);
    await rivalPage.goto(`/en/lots/${SLUG}`);
    await rivalPage.getByRole("button", { name: /^Bid / }).click();
    await expect(rivalPage.getByText("Your bid was accepted.")).toBeVisible();
    await rival.close();

    const after = await prisma.bid.aggregate({
      where: { lotId, status: "accepted" },
      _max: { amountMinor: true },
    });
    expect(after._max.amountMinor).toBeGreaterThan(current);

    // The first page updates itself within a poll or two.
    await expect(page.getByText(`Current bid`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Bid ${eur(after._max.amountMinor! + 1_000_000n)}` }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("tells the outbid bidder, not the one who outbid them", async () => {
    const queued = await prisma.outbox.findMany({
      where: { userId: approvedId, template: "outbid" },
    });
    expect(queued.length).toBeGreaterThan(0);

    expect(
      await prisma.outbox.count({ where: { userId: rivalId, template: "outbid" } }),
    ).toBe(0);
  });
});

test.describe("the closing worker", () => {
  test("is shut to a caller without the secret", async ({ request }) => {
    const anonymous = await request.post("/api/internal/close-lots");
    // 404 rather than 401 — an unauthenticated caller learns nothing.
    expect(anonymous.status()).toBe(404);

    const wrong = await request.post("/api/internal/close-lots", {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(wrong.status()).toBe(404);
  });

  test("closes a lot whose clock has run out", async ({ request }) => {
    const draft = await prisma.lot.findFirstOrThrow({
      where: { property: { slug: "partsel-pirin-bansko" } },
      select: { id: true, status: true, effectiveCloseAt: true },
    });

    await prisma.lot.update({
      where: { id: draft.id },
      data: { status: "BIDDING_OPEN", effectiveCloseAt: new Date(Date.now() - 60_000) },
    });

    try {
      const response = await request.post("/api/internal/close-lots", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      expect(response.ok()).toBe(true);

      const after = await prisma.lot.findUniqueOrThrow({
        where: { id: draft.id },
        select: { status: true, closedAt: true },
      });
      // No bids were placed on it, so there is nothing to sell.
      expect(after.status).toBe("CLOSED_UNSOLD");
      expect(after.closedAt).not.toBeNull();
    } finally {
      await prisma.lot.update({
        where: { id: draft.id },
        data: { status: draft.status, effectiveCloseAt: draft.effectiveCloseAt, closedAt: null },
      });
    }
  });

  test("leaves a lot alone while its clock is still running", async ({ request }) => {
    const response = await request.post("/api/internal/close-lots", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(response.ok()).toBe(true);

    const lot = await prisma.lot.findUniqueOrThrow({
      where: { id: lotId },
      select: { status: true },
    });
    expect(lot.status).toBe("BIDDING_OPEN");
  });
});
