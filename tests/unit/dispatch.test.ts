import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchOutbox } from "@/server/notifications/dispatch";
import { enqueue } from "@/server/notifications/outbox";
import { render, TEMPLATE_NAMES } from "@/server/notifications/templates";
import * as transportModule from "@/server/notifications/transport";

/*
 * The outbox dispatcher.
 *
 * Worth its own file because until it existed, enqueue() wrote rows that
 * nothing read — every deposit confirmation, viewing booking and outbid
 * alert since Phase 1 went into the table and stayed there. The only
 * mail that ever appeared was registration's, which sent directly as
 * well as queueing.
 */

const prisma = new PrismaClient();
const PREFIX = "vitest-dispatch-";

let bgUserId = "";
let enUserId = "";
let lotId = "";

async function cleanup() {
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await cleanup();

  const base = {
    passwordHash: "not-used",
    firstName: "Тест",
    lastName: "Получател",
    dateOfBirth: new Date("1990-01-01"),
    accountType: "individual" as const,
    emailVerifiedAt: new Date(),
  };

  const bg = await prisma.user.create({
    data: { ...base, email: `${PREFIX}bg@example.bg`, locale: "bg" },
    select: { id: true },
  });
  bgUserId = bg.id;

  const en = await prisma.user.create({
    data: { ...base, email: `${PREFIX}en@example.bg`, locale: "en" },
    select: { id: true },
  });
  enUserId = en.id;

  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: "tristaen-lozenets-sofia" } },
    select: { id: true },
  });
  lotId = lot.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/**
 * Stand in for the wire, so nothing here can send a real message.
 *
 * `mine` filters to this file's recipients. dispatchOutbox drains the
 * whole table — correctly; that is its job — and vitest runs files in
 * parallel, so a bare length assertion here counts whatever registration
 * and viewings happened to queue at the same moment.
 */
function stubTransport() {
  const sent: { to: string; subject: string; text: string }[] = [];
  vi.spyOn(transportModule.transport, "send").mockImplementation(async (message) => {
    sent.push(message);
  });
  return {
    all: sent,
    mine: () => sent.filter((m) => m.to.startsWith(PREFIX)),
  };
}

describe("draining the queue", () => {
  it("sends a queued message and marks it sent", async () => {
    const sent = stubTransport();

    await enqueue({
      userId: bgUserId,
      channel: "email",
      template: "outbid",
      payload: { lotId, amountMinor: "35500000" },
    });

    await dispatchOutbox();

    expect(sent.mine()).toHaveLength(1);
    expect(sent.mine()[0].to).toBe(`${PREFIX}bg@example.bg`);

    const row = await prisma.outbox.findFirstOrThrow({ where: { userId: bgUserId } });
    expect(row.sentAt).not.toBeNull();
  });

  it("does not send the same message twice", async () => {
    const sent = stubTransport();

    await enqueue({
      userId: bgUserId,
      channel: "email",
      template: "outbid",
      payload: { lotId, amountMinor: "35500000" },
    });

    await dispatchOutbox();
    await dispatchOutbox();

    expect(sent.mine()).toHaveLength(1);
  });

  it("writes in the recipient's language, not the sender's", async () => {
    /*
     * A Bulgarian bidder outbid by an English-speaking one gets
     * Bulgarian. The locale on the row is the only thing that decides it.
     */
    const sent = stubTransport();

    for (const userId of [bgUserId, enUserId]) {
      await enqueue({
        userId,
        channel: "email",
        template: "outbid",
        payload: { lotId, amountMinor: "35500000" },
      });
    }

    await dispatchOutbox();

    const bg = sent.mine().find((m) => m.to.includes("bg@"))!;
    const en = sent.mine().find((m) => m.to.includes("en@"))!;

    expect(bg.subject).toContain("Наддадоха ви");
    expect(en.subject).toContain("You have been outbid");
  });

  it("names the lot rather than saying 'your lot'", async () => {
    const sent = stubTransport();

    await enqueue({
      userId: enUserId,
      channel: "email",
      template: "outbid",
      payload: { lotId, amountMinor: "35500000" },
    });

    await dispatchOutbox();

    const message = sent.mine()[0];
    expect(message.text).toContain("Lot 012");
    expect(message.text).toContain("/en/lots/tristaen-lozenets-sofia");
    // Formatted by the same function the page uses, so the two never
    // disagree about what €355,000 looks like.
    expect(message.text).toContain("€355,000");
  });
});

describe("when delivery fails", () => {
  it("leaves the message unsent, counts the attempt and backs off", async () => {
    vi.spyOn(transportModule.transport, "send").mockRejectedValue(new Error("provider down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await enqueue({
      userId: bgUserId,
      channel: "email",
      template: "outbid",
      payload: { lotId, amountMinor: "35500000" },
    });

    await dispatchOutbox();

    const row = await prisma.outbox.findFirstOrThrow({ where: { userId: bgUserId } });
    // Unsent is the whole point — the outbox exists so an outage delays
    // a message rather than losing it.
    expect(row.sentAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.sendAfter!.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not retry a message that is still backing off", async () => {
    const sent = stubTransport();

    await enqueue({
      userId: bgUserId,
      channel: "email",
      template: "outbid",
      payload: { lotId, amountMinor: "35500000" },
    });
    await prisma.outbox.updateMany({
      where: { userId: bgUserId },
      data: { attempts: 1, sendAfter: new Date(Date.now() + 60_000) },
    });

    await dispatchOutbox();
    expect(sent.mine()).toHaveLength(0);
  });

  it("stops after five attempts rather than retrying a bad address forever", async () => {
    const sent = stubTransport();

    await enqueue({
      userId: bgUserId,
      channel: "email",
      template: "outbid",
      payload: { lotId, amountMinor: "35500000" },
    });
    await prisma.outbox.updateMany({ where: { userId: bgUserId }, data: { attempts: 5 } });

    await dispatchOutbox();
    expect(sent.mine()).toHaveLength(0);

    // Still unsent, deliberately. The row is the evidence somebody was
    // never told — marking it sent would erase that.
    const row = await prisma.outbox.findFirstOrThrow({ where: { userId: bgUserId } });
    expect(row.sentAt).toBeNull();
  });

  it("does not let one unrenderable message block the queue behind it", async () => {
    const sent = stubTransport();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await enqueue({
      userId: bgUserId,
      channel: "email",
      template: "template_that_does_not_exist",
      payload: {},
    });
    await enqueue({
      userId: enUserId,
      channel: "email",
      template: "outbid",
      payload: { lotId, amountMinor: "35500000" },
    });

    const outcomes = await dispatchOutbox();

    expect(outcomes.some((o) => o.result === "unknown-template")).toBe(true);
    expect(sent.mine()).toHaveLength(1);
    expect(errors).toHaveBeenCalled();
  });
});

describe("the copy itself", () => {
  it("renders every template in both languages", async () => {
    /*
     * A template added on one side only is a message that arrives in the
     * wrong language, and nothing else would catch it — the dispatcher
     * picks the locale at send time, long after review.
     */
    for (const name of TEMPLATE_NAMES) {
      for (const locale of ["bg", "en"] as const) {
        const rendered = render(name, {
          locale,
          baseUrl: "https://example.test",
          payload: { verifyUrl: "u", signInUrl: "u", amountMinor: "10000", startsAt: new Date().toISOString() },
          lot: { lotRef: "012", slug: "a-lot", title: "Заглавие" },
        });

        expect(rendered, `${name}/${locale}`).not.toBeNull();
        expect(rendered!.subject.length, `${name}/${locale} subject`).toBeGreaterThan(0);
        expect(rendered!.text.length, `${name}/${locale} body`).toBeGreaterThan(0);
        // A missing interpolation shows up as the literal placeholder.
        expect(rendered!.text, `${name}/${locale}`).not.toContain("undefined");
        expect(rendered!.text, `${name}/${locale}`).not.toContain("{");
      }
    }
  });

  it("covers every template the application enqueues", () => {
    /*
     * The other direction: an enqueue site whose name nothing renders.
     * That one only shows up in production, as an error log and a
     * message nobody received.
     */
    const enqueued = [
      "verify_email",
      "registration_attempt_existing_account",
      "outbid",
      "deposit_received",
      "deposit_released",
      "lot_won",
      "lot_reserve_not_met",
      "viewing_booked",
      "viewing_cancelled_by_bidder",
      "viewing_cancelled_by_house",
    ];

    expect(TEMPLATE_NAMES.sort()).toEqual(enqueued.sort());
  });
});
