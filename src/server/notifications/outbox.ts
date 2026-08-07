import type { NotificationChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
 * Everything the system sends goes through the outbox table first, then
 * a transport picks it up. Writing the row in the same transaction as
 * the thing that caused it means a message is never lost because the
 * mail provider was briefly down, and never sent for an action that was
 * subsequently rolled back.
 *
 * Delivery is stubbed for now — see transport.ts. The queue itself is
 * real, so swapping in a provider touches one file.
 */

export type OutboxMessage = {
  /**
   * Exactly one recipient. A bidder is a User; a seller is not — §11
   * keeps them a record rather than an account — so they are addressed
   * separately, and a database check constraint enforces the "exactly
   * one" rather than trusting every call site to remember.
   */
  userId?: string;
  sellerId?: string;
  channel: NotificationChannel;
  /** Template name; the transport owns the copy. */
  template: string;
  payload: Record<string, unknown>;
};

/**
 * Either the ordinary client or a transaction one. `PrismaClient`
 * satisfies `TransactionClient`, which is it minus the methods that
 * cannot be nested.
 */
type OutboxClient = Prisma.TransactionClient;

/**
 * @param client pass the transaction client when enqueuing inside a
 *   transaction. Two reasons, and the second one bites hard:
 *
 *   1. The message should commit or roll back with the thing that caused
 *      it. That is the whole point of an outbox.
 *
 *   2. Using the global client inside a transaction asks the pool for a
 *      *second* connection while the first is still held. Under
 *      concurrency every caller does the same and the pool deadlocks —
 *      which is exactly how the viewing-booking tests started timing out
 *      rather than reporting a full slot.
 */
export async function enqueue(
  message: OutboxMessage,
  client: OutboxClient = prisma,
): Promise<void> {
  if (Boolean(message.userId) === Boolean(message.sellerId)) {
    // Caught here as well as by the constraint, because the error a
    // developer sees at the call site is far more useful than a Postgres
    // check violation surfacing from inside a transaction.
    throw new Error("An outbox message needs exactly one of userId or sellerId.");
  }

  await client.outbox.create({
    data: {
      userId: message.userId ?? null,
      sellerId: message.sellerId ?? null,
      channel: message.channel,
      template: message.template,
      payload: message.payload as never,
    },
  });
}
