import type { NotificationChannel } from "@prisma/client";
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
  userId: string;
  channel: NotificationChannel;
  /** Template name; the transport owns the copy. */
  template: string;
  payload: Record<string, unknown>;
};

export async function enqueue(message: OutboxMessage): Promise<void> {
  await prisma.outbox.create({
    data: {
      userId: message.userId,
      channel: message.channel,
      template: message.template,
      payload: message.payload as never,
    },
  });
}
