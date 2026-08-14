import { NextResponse } from "next/server";
import { dispatchOutbox } from "@/server/notifications/dispatch";
import { authoriseWorker } from "@/server/auction/worker-auth";
import { evictExpiredIfDue } from "@/server/identity/rate-limit";

/*
 * Drains the outbox — the other half of what scripts/close-worker.mjs
 * drives, and for the same reasons as the closing endpoint: a scheduler
 * can call it, it can be triggered by hand, and it does not depend on a
 * timer surviving inside a Next process.
 *
 * dispatchOutbox claims rows with FOR UPDATE SKIP LOCKED, so overlapping
 * calls share the work rather than sending anything twice.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authoriseWorker(request)) {
    // 404 rather than 401 — an unauthenticated caller learns nothing.
    return new NextResponse("Not found", { status: 404 });
  }

  const outcomes = await dispatchOutbox();

  /*
   * Piggy-backed on the tick the worker already makes, rather than given
   * a scheduler of its own. Self-throttled to about once an hour, and a
   * failed sweep must never fail the dispatch it rode in on — old
   * rate-limit rows are housekeeping, queued mail is the job.
   */
  const swept = await evictExpiredIfDue().catch((error) => {
    console.error("[rate-limit] sweep failed; rows will be collected next hour:", error);
    return null;
  });

  return NextResponse.json({
    ...(swept === null ? {} : { rateLimitRowsEvicted: swept }),
    sent: outcomes.filter((o) => o.result === "sent").length,
    retry: outcomes.filter((o) => o.result === "retry").length,
    // Both of these mean somebody was not told something. They belong in
    // the response so a scheduler's logs show them without a database.
    abandoned: outcomes.filter((o) => o.result === "abandoned").length,
    unknownTemplate: outcomes.filter((o) => o.result === "unknown-template").length,
  });
}
