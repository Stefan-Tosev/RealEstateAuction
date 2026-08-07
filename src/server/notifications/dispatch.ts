import { prisma } from "@/lib/prisma";
import type { Locale } from "@/lib/i18n/locales";
import { render } from "./templates";
import { transport } from "./transport";

/*
 * Drains the outbox.
 *
 * Until this existed, enqueue() wrote rows that nothing ever read —
 * every deposit confirmation, viewing booking and outbid alert since
 * Phase 1 went into the table and stopped there. Registration papered
 * over it by also sending directly, which is why it was the only mail
 * that ever appeared.
 *
 * Claims rows with FOR UPDATE SKIP LOCKED, the same pattern as the
 * closing worker, so more than one dispatcher can run without sending
 * anything twice.
 *
 * Ordering is by creation, but nothing depends on it: these messages are
 * independent, and one message that keeps failing must not hold up the
 * queue behind it. That is what the attempt backoff is for.
 */

/** Enough for a provider blip; not so many that a bad address is retried forever. */
const MAX_ATTEMPTS = 5;

/** 1, 2, 4, 8, 16 minutes. Long enough to outlast an outage, short enough to matter. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 16) * 60_000;
}

export type DispatchOutcome = {
  id: string;
  result: "sent" | "retry" | "abandoned" | "unknown-template" | "vanished";
};

/** Prisma's "record not found" — the row went while we were working on it. */
const RECORD_NOT_FOUND = "P2025";

function isMissingRecord(error: unknown): boolean {
  return (error as { code?: string })?.code === RECORD_NOT_FOUND;
}

export async function dispatchOutbox(limit = 25): Promise<DispatchOutcome[]> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM outbox
     WHERE sent_at IS NULL
       AND attempts < ${MAX_ATTEMPTS}
       AND (send_after IS NULL OR send_after <= clock_timestamp())
     ORDER BY created_at
     LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
  `;

  const outcomes: DispatchOutcome[] = [];

  for (const { id } of due) {
    /*
     * One message must never stop the queue. A poisoned row, a deleted
     * recipient, an unserialisable payload — whatever it is, everything
     * queued behind it still has to go out.
     */
    try {
      outcomes.push(await dispatchOne(id, baseUrl));
    } catch (error) {
      if (isMissingRecord(error)) {
        outcomes.push({ id, result: "vanished" });
        continue;
      }
      console.error(`[dispatch] message ${id} threw and was skipped:`, error);
      outcomes.push({ id, result: "retry" });
    }
  }

  return outcomes;
}

async function dispatchOne(id: string, baseUrl: string): Promise<DispatchOutcome> {
  const message = await prisma.outbox.findUnique({
    where: { id },
    select: {
      template: true,
      payload: true,
      attempts: true,
      sentAt: true,
      // The recipient's locale, not the sender's: a Bulgarian bidder
      // outbid by an English-speaking one gets Bulgarian.
      user: { select: { email: true, locale: true } },
      seller: { select: { email: true, locale: true } },
    },
  });

  // Claimed by another dispatcher between the scan and this read.
  if (!message || message.sentAt) return { id, result: "sent" };

  /*
   * Whichever of the two is set. A seller without an email address is a
   * record somebody entered in a hurry; there is nothing to send to, and
   * failing every attempt would just fill the log.
   */
  const recipient = message.user ?? message.seller;
  if (!recipient?.email) {
    console.error(`[dispatch] message ${id} has no deliverable address. Marking it done.`);
    await prisma.outbox.update({ where: { id }, data: { sentAt: new Date() } });
    return { id, result: "unknown-template" };
  }

  const payload = (message.payload ?? {}) as Record<string, unknown>;

  /*
   * Resolved here rather than stored at enqueue time. Enqueue happens
   * inside the transaction that caused the message, where an extra query
   * costs a row lock held for longer; this runs on its own.
   */
  const lot =
    typeof payload.lotId === "string"
      ? await prisma.lot.findUnique({
          where: { id: payload.lotId },
          select: {
            lotNumber: true,
            property: { select: { slug: true, titleBg: true, titleEn: true } },
          },
        })
      : null;

  const locale = recipient.locale as Locale;

  const rendered = render(message.template, {
    locale,
    baseUrl,
    payload,
    lot: lot
      ? {
          lotRef: String(lot.lotNumber).padStart(3, "0"),
          slug: lot.property.slug,
          title: locale === "bg" ? lot.property.titleBg : lot.property.titleEn,
        }
      : null,
  });

  if (!rendered) {
    /*
     * A template name nothing knows how to render. Marked sent so it
     * stops being retried — the row stays as the record that the event
     * happened — and logged loudly, because it means an enqueue site and
     * templates.ts disagree.
     */
    console.error(
      `[dispatch] no template named "${message.template}". Message ${id} will not be sent.`,
    );
    await prisma.outbox.update({ where: { id }, data: { sentAt: new Date() } });
    return { id, result: "unknown-template" };
  }

  try {
    await transport.send({
      to: recipient.email,
      subject: rendered.subject,
      text: rendered.text,
    });
  } catch (error) {
    const attempts = message.attempts + 1;
    const abandoned = attempts >= MAX_ATTEMPTS;

    try {
      await prisma.outbox.update({
        where: { id },
        data: {
          attempts,
          // Left unsent either way. An abandoned message is excluded by
          // the attempts ceiling rather than by pretending it was sent —
          // the row is the evidence somebody was never told.
          sendAfter: new Date(Date.now() + backoffMs(attempts)),
        },
      });
    } catch (updateError) {
      // Gone as well. Nothing left to record the attempt against.
      if (!isMissingRecord(updateError)) throw updateError;
      return { id, result: "vanished" };
    }

    console.error(
      `[dispatch] attempt ${attempts}/${MAX_ATTEMPTS} failed for ${message.template}:`,
      error instanceof Error ? error.message : error,
    );

    return { id, result: abandoned ? "abandoned" : "retry" };
  }

  /*
   * The row can disappear between the send and this update — a user
   * erased under GDPR, an operator purging, or in the test suite another
   * spec cleaning up a recipient it owns. The message HAS been sent, so
   * the interesting failure would be sending it twice; losing the receipt
   * is not worth an exception that abandons the rest of the batch.
   */
  try {
    await prisma.outbox.update({
      where: { id },
      data: { sentAt: new Date(), attempts: message.attempts + 1 },
    });
  } catch (error) {
    if (!isMissingRecord(error)) throw error;
    return { id, result: "vanished" };
  }

  return { id, result: "sent" };
}
