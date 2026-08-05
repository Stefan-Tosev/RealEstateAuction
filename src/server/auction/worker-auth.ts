import { timingSafeEqual } from "node:crypto";

/*
 * The shared check for every endpoint a scheduler calls.
 *
 * One implementation because there are two of them now — closing lots
 * and draining the outbox — and a second copy of an auth check is how
 * one of them quietly ends up weaker than the other.
 */
export function authoriseWorker(request: Request): boolean {
  const expected = process.env.CRON_SECRET;

  /*
   * No secret configured means these stay shut. Failing open would leave
   * endpoints that close auctions and send mail exposed to anyone who
   * guesses the path — and the failure mode of failing closed is visible
   * (lots stop closing, mail stops sending) rather than silent.
   */
  if (!expected) return false;

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
