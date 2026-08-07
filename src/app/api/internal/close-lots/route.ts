import { NextResponse } from "next/server";
import { closeDueLots } from "@/server/auction/close-lots";
import { expireNegotiationWindows } from "@/server/auction/negotiation";
import { authoriseWorker } from "@/server/auction/worker-auth";

/*
 * The closing worker's entry point — §3, "Closing a lot": "A worker
 * every few seconds."
 *
 * An endpoint rather than a setInterval inside the app, because a timer
 * in a Next process is the wrong shape: it dies with a redeploy, runs
 * once per instance when there are several, and cannot be triggered or
 * observed. This is callable by any scheduler — cron, a platform cron
 * trigger, or scripts/close-worker.mjs for local running.
 *
 * closeDueLots is idempotent and takes FOR UPDATE SKIP LOCKED, so
 * overlapping calls are safe: two schedulers firing at once simply share
 * the work rather than fighting over it.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authoriseWorker(request)) {
    // 404 rather than 401: an unauthenticated caller learns nothing
    // about whether this endpoint exists.
    return new NextResponse("Not found", { status: 404 });
  }

  const outcomes = await closeDueLots();

  /*
   * §10's window is a promise with a deadline, so something has to
   * enforce the deadline. An expiry is a decline nobody got round to
   * making, and a bidder's money cannot stay held because an auctioneer
   * was on holiday.
   */
  const expired = await expireNegotiationWindows();

  return NextResponse.json({
    closed: outcomes.filter((o) => o.result === "sold" || o.result === "unsold").length,
    reserveNotMet: outcomes.filter((o) => o.result === "reserve-not-met").length,
    // A lot a late bid extended between the scan and the lock. Not an
    // error — it is the anti-snipe guarantee working.
    extended: outcomes.filter((o) => o.result === "extended").length,
    negotiationsExpired: expired.length,
    outcomes,
  });
}
