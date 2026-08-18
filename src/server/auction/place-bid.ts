import { prisma } from "@/lib/prisma";
import { enqueue } from "@/server/notifications/outbox";
import { POLICY_VERSION, hasAcceptedCurrentTerms } from "@/server/identity/terms";
import { minimumNextBid } from "./increments";

/*
 * Placing a bid — §3, "Placing a bid".
 *
 * One transaction, serialized per lot by a row lock on `lots`. That lock
 * is what makes the race between a final bid and the closing worker
 * impossible: both contend for the same row and the database decides the
 * order.
 *
 * The invariants this file exists to satisfy (§3):
 *
 *   1. Server clock only. A client timestamp never influences anything.
 *   2. Judge by server receive time, re-checked inside the lock — a
 *      valid bid must not be rejected by its own processing latency.
 *   3. Two bids in the same final second both serialize, and the second
 *      extends from the already-extended time.
 *   4. A bid 50ms after close loses cleanly, with a reason, and is still
 *      recorded.
 *   6. `bids` is append-only, enforced by a database trigger.
 *
 * Rejected bids are INSERTED, not discarded. A bidder who was beaten by
 * milliseconds is owed a record of having tried, and a dispute needs the
 * losing attempts as much as the winning one.
 */

export type BidRejection =
  | "NOT_OPEN"
  | "CLOSED"
  | "NOT_APPROVED"
  | "NO_DEPOSIT"
  | "TERMS_OUTDATED"
  | "TOO_LOW"
  | "NOT_ON_STEP"
  | "NOT_FOUND";

export type BidOutcome =
  | { ok: true; bidId: string; amountMinor: bigint; extendedTo: Date | null; replayed: boolean }
  | { ok: false; reason: BidRejection; minimumMinor?: bigint; bidId?: string };

export type BidRequest = {
  lotId: string;
  userId: string;
  amountMinor: bigint;
  /** Supplied by the client; a retry or double-click reuses it. */
  idempotencyKey: string;
  clientIp?: string | null;
  userAgent?: string | null;
};

/*
 * NOT IMPLEMENTED: the SELF_BIDDING gate from §3.
 *
 * Sellers are not modelled anywhere — properties and lots have no owner
 * relation, and there are no seller accounts — so there is nothing to
 * compare the bidder against. Inventing a nullable column to satisfy one
 * check would model sellers as an afterthought, and §10 needs them
 * properly for entry fees, commission and withdrawal fees.
 *
 * When sellers exist, add the gate here, and see docs/architecture.md
 * for the agreed access design: a seller sees the same public price
 * everyone does, never bidder identities, and gets a full anonymised bid
 * log after close.
 */

export async function placeBid(request: BidRequest): Promise<BidOutcome> {
  /*
   * Set inside the transaction, read only after it has committed. If the
   * transaction throws, $transaction rejects and this is never reached;
   * if it returns, the bid is durable and the person it displaced is
   * owed an alert.
   */
  const pending: { displaced: { userId: string; amountMinor: bigint } | null } = {
    displaced: null,
  };

  const outcome = await prisma.$transaction(async (tx) => {
    /*
     * Lock the lot first. Everything below happens with no other bid on
     * this lot in flight and with the closing worker blocked.
     */
    const locked = await tx.$queryRaw<
      {
        status: string;
        effective_close_at: Date | null;
        starting_price_minor: bigint;
        bid_increment_minor: bigint | null;
        deposit_required_minor: bigint | null;
        soft_close_window_seconds: number;
        soft_close_reset_seconds: number;
        extension_count: number;
        soft_close_schedule: unknown;
        now: Date;
      }[]
    >`
      SELECT status::text,
             effective_close_at,
             starting_price_minor,
             bid_increment_minor,
             deposit_required_minor,
             soft_close_window_seconds,
             soft_close_reset_seconds,
             extension_count,
             soft_close_schedule,
             clock_timestamp() AS now
        FROM lots
       WHERE id = ${request.lotId}::uuid
         FOR UPDATE
    `;

    const lot = locked[0];
    if (!lot) return { ok: false, reason: "NOT_FOUND" } as const;

    /*
     * Idempotency before anything else: a retry must return the original
     * outcome rather than being judged afresh against a clock that has
     * moved on. §3 puts this after the amount check, but a replay that
     * arrives after the close would then be rejected despite the first
     * attempt having succeeded — checking first is strictly safer and
     * changes no accepted-path behaviour.
     */
    const existing = await tx.bid.findUnique({
      where: {
        lotId_userId_idempotencyKey: {
          lotId: request.lotId,
          userId: request.userId,
          idempotencyKey: request.idempotencyKey,
        },
      },
    });

    if (existing) {
      return existing.status === "accepted"
        ? ({
            ok: true,
            bidId: existing.id,
            amountMinor: existing.amountMinor,
            extendedTo: existing.causedExtensionTo,
            replayed: true,
          } as const)
        : ({
            ok: false,
            reason: (existing.rejectReason ?? "TOO_LOW") as BidRejection,
            bidId: existing.id,
          } as const);
    }

    // clock_timestamp(), read inside the lock — invariants 1 and 2.
    const now = lot.now;

    /** Records the attempt and returns the rejection. Losing bids are evidence. */
    const reject = async (reason: BidRejection, minimumMinor?: bigint) => {
      const bid = await tx.bid.create({
        data: {
          lotId: request.lotId,
          userId: request.userId,
          amountMinor: request.amountMinor,
          receivedAt: now,
          status: "rejected",
          rejectReason: reason,
          idempotencyKey: request.idempotencyKey,
          clientIp: request.clientIp ?? null,
          userAgent: request.userAgent ?? null,
          policyVersion: POLICY_VERSION,
        },
      });
      return { ok: false as const, reason, minimumMinor, bidId: bid.id };
    };

    // ---- Gates, in the spec's order ----

    if (lot.status !== "BIDDING_OPEN" && lot.status !== "EXTENDING") {
      return reject("NOT_OPEN");
    }

    // Invariant 4: a bid after the close loses cleanly and is recorded.
    if (!lot.effective_close_at || now >= lot.effective_close_at) {
      return reject("CLOSED");
    }

    const approvals = await tx.bidderApproval.count({
      where: { userId: request.userId, status: "approved" },
    });
    if (approvals === 0) return reject("NOT_APPROVED");

    /*
     * Bound to a named version of the terms, not to whatever they say
     * today. A bid is binding because the bidder accepted terms that
     * said so, which is only provable if the version they accepted is
     * the version in force.
     *
     * Refused rather than silently re-consented: agreement has to be an
     * act. Recorded as a rejected bid like every other refusal, so the
     * attempt is still evidence that they tried.
     */
    if (!(await hasAcceptedCurrentTerms(tx, request.userId))) {
      return reject("TERMS_OUTDATED");
    }

    if (lot.deposit_required_minor && lot.deposit_required_minor > 0n) {
      const held = await tx.deposit.count({
        where: { userId: request.userId, lotId: request.lotId, status: "held" },
      });
      if (held === 0) return reject("NO_DEPOSIT");
    }

    // ---- Amount ----

    const highest = await tx.bid.aggregate({
      where: { lotId: request.lotId, status: "accepted" },
      _max: { amountMinor: true },
    });
    const highestMinor = highest._max.amountMinor ?? null;

    /*
     * Exactly one amount is valid. §3 originally made this a floor with
     * jump bids allowed; it is a fixed step now, because a free-text
     * amount lets a bidder type an extra zero and a bid binds.
     *
     * The two failure directions are kept apart on purpose. Below the
     * step means somebody took that rung first — the ordinary race in a
     * busy endgame, and the bidder just needs the new price. Above it
     * cannot come from the interface at all, which makes it worth
     * recording as its own thing.
     */
    const minimum = await minimumNextBid(
      tx,
      highestMinor,
      lot.starting_price_minor,
      lot.bid_increment_minor,
    );
    if (request.amountMinor < minimum) return reject("TOO_LOW", minimum);
    if (request.amountMinor > minimum) return reject("NOT_ON_STEP", minimum);

    // ---- Soft close ----

    const closeAt = lot.effective_close_at;
    const windowSeconds = windowFor(lot.soft_close_schedule, lot.extension_count, lot.soft_close_window_seconds);
    const insideWindow = closeAt.getTime() - now.getTime() <= windowSeconds * 1000;

    /*
     * Reset, do not add (§3). Adding lets ten rapid bids pile on fifty
     * minutes; resetting keeps the promise simple and true — there will
     * always be five quiet minutes before the gavel.
     *
     * Invariant 3: the second of two bids in the same final second
     * extends from the already-extended time, because it reads
     * effective_close_at after the first transaction committed.
     *
     * The reset follows the schedule rather than sitting at a flat
     * soft_close_reset_seconds, which now acts as a cap. Decaying only
     * the trigger window changes *which* bids extend but never *by how
     * much*, so a decaying schedule shortened nothing at all. The
     * default schedule is flat five minutes — see windowFor.
     */
    const resetSeconds = Math.min(windowSeconds, lot.soft_close_reset_seconds);
    const extendedTo = insideWindow ? new Date(now.getTime() + resetSeconds * 1000) : null;

    const previous = await tx.bid.findFirst({
      where: { lotId: request.lotId, status: "accepted" },
      orderBy: { amountMinor: "desc" },
      select: { id: true, userId: true },
    });

    /*
     * Recorded here, sent after the transaction commits. §3: "Only after
     * commit: broadcast to subscribers, then enqueue outbid
     * notifications." A notification sent inside the transaction can
     * describe a bid that then rolls back, and there is no unsending it.
     *
     * Nobody is told they were outbid by themselves. Raising your own
     * highest bid is legitimate — fixed steps make it the only way to
     * signal above the next rung — but it is not an outbidding.
     */
    if (previous && previous.userId !== request.userId) {
      pending.displaced = { userId: previous.userId, amountMinor: request.amountMinor };
    }

    const bid = await tx.bid.create({
      data: {
        lotId: request.lotId,
        userId: request.userId,
        amountMinor: request.amountMinor,
        receivedAt: now,
        status: "accepted",
        idempotencyKey: request.idempotencyKey,
        causedExtensionTo: extendedTo,
        previousBidId: previous?.id ?? null,
        clientIp: request.clientIp ?? null,
        userAgent: request.userAgent ?? null,
        policyVersion: POLICY_VERSION,
      },
    });

    if (extendedTo) {
      await tx.lot.update({
        where: { id: request.lotId },
        data: {
          effectiveCloseAt: extendedTo,
          status: "EXTENDING",
          extensionCount: { increment: 1 },
        },
      });
    }

    return {
      ok: true as const,
      bidId: bid.id,
      amountMinor: bid.amountMinor,
      extendedTo,
      replayed: false,
    };
  });

  /*
   * §4: "Indefinite extension is only fair if outbid bidders know."
   * Without this the soft close protects whoever happens to be staring
   * at the screen, which is a fairness defect rather than a missing
   * nicety. Queued through the outbox so a mail provider outage delays
   * it instead of losing it.
   *
   * A failure here must not undo an accepted bid. The bid is committed
   * and binding; a missing email is a smaller problem than a bid that
   * vanishes because the notification queue hiccuped.
   */
  if (outcome.ok && pending.displaced) {
    try {
      await enqueue({
        userId: pending.displaced.userId,
        channel: "email",
        template: "outbid",
        payload: {
          lotId: request.lotId,
          amountMinor: pending.displaced.amountMinor.toString(),
        },
      });
    } catch (error) {
      console.error("[place-bid] outbid notification could not be queued:", error);
    }
  }

  return outcome;
}

/**
 * The quiet period a bid resets the clock to — both the width of the
 * trigger window and the length of the reset.
 *
 * Flat five minutes by default. §3 originally specified a decay to three
 * and then two minutes, and the mechanism is still here, but the default
 * no longer uses it:
 *
 *   - The decay existed to stop two bidders grinding the *minimum*
 *     increment for hours. That was written when the step at €345,000
 *     was €5,000; at the current bands it is €10,000, so thirty rounds
 *     means the price moved €300,000. That is not a pathology to defend
 *     against.
 *   - §3 permits the two-minute floor only "provided outbid
 *     notifications are working". They are §4, and unbuilt. Without
 *     them a two-minute window means keeping your lot depends on
 *     happening to be at the screen, which is the exact unfairness soft
 *     close exists to remove.
 *   - Five minutes is already thin for committing to a six-figure
 *     purchase. Two is a pressure tactic, and it makes the guarantee
 *     harder to state: "there will always be five quiet minutes before
 *     the gavel" is something a bidder can hold in their head.
 *
 * A lot may still carry its own schedule in soft_close_schedule, so an
 * endgame that genuinely drags can be given a decay without a deploy.
 */
export function windowFor(
  schedule: unknown,
  extensionCount: number,
  fallbackSeconds: number,
): number {
  const steps = Array.isArray(schedule)
    ? (schedule as { afterExtensions: number; windowSeconds: number }[])
    : DEFAULT_SCHEDULE;

  let chosen = fallbackSeconds;
  for (const step of steps) {
    if (extensionCount >= step.afterExtensions) chosen = step.windowSeconds;
  }
  return chosen;
}

/**
 * Used when a lot carries no per-lot schedule.
 *
 * One entry, so the window never changes. The shape stays an array
 * because windowFor still honours a decaying schedule set on a lot — see
 * the note above on why the default is not one.
 */
export const DEFAULT_SCHEDULE = [{ afterExtensions: 0, windowSeconds: 300 }];
