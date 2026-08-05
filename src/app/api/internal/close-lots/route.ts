import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { closeDueLots } from "@/server/auction/close-lots";

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

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;

  /*
   * No secret configured means this stays shut. Failing open would leave
   * an endpoint that closes auctions exposed to anyone who guesses the
   * path — and the failure mode of failing closed is visible (lots stop
   * closing) rather than silent.
   */
  if (!expected) return false;

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    // 404 rather than 401: an unauthenticated caller learns nothing
    // about whether this endpoint exists.
    return new NextResponse("Not found", { status: 404 });
  }

  const outcomes = await closeDueLots();

  return NextResponse.json({
    closed: outcomes.filter((o) => o.result === "sold" || o.result === "unsold").length,
    reserveNotMet: outcomes.filter((o) => o.result === "reserve-not-met").length,
    // A lot a late bid extended between the scan and the lock. Not an
    // error — it is the anti-snipe guarantee working.
    extended: outcomes.filter((o) => o.result === "extended").length,
    outcomes,
  });
}
