import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

/*
 * Rate limiting, per docs/server-validation.md §6.
 *
 * Backed by Postgres. It used to be an in-memory Map, which held for
 * exactly one box: with two application instances an attacker got the
 * whole allowance once per instance, and a restart cleared every counter.
 * Postgres rather than Redis because the database is already here, and a
 * limiter is not worth a second piece of infrastructure to run, back up
 * and monitor.
 *
 * §6 also requires the keys be hashed: "Rate-limit keys must be hashed
 * (HMAC(email)), not raw addresses, so the limiter store isn't a
 * plaintext user list." A limiter holding every address that ever tried
 * to register is a breach waiting to be dumped.
 */

const SECRET = process.env.AUTH_SECRET ?? "development-only-rate-limit-key";

function keyFor(scope: string, value: string): string {
  return `${scope}:${createHmac("sha256", SECRET).update(value.toLowerCase()).digest("hex")}`;
}

export type Limit = { max: number; windowMs: number };

export const LIMITS = {
  /** §6: 5 registrations/hour, 20/day per IP. */
  registrationPerIpHour: { max: 5, windowMs: 60 * 60 * 1000 },
  registrationPerIpDay: { max: 20, windowMs: 24 * 60 * 60 * 1000 },
  /** §6: 3 attempts/hour per email. */
  registrationPerEmailHour: { max: 3, windowMs: 60 * 60 * 1000 },
  /*
   * Bid attempts per signed-in bidder. Rejected bids are INSERTed by
   * design (§3 — a bidder beaten by milliseconds is owed a record of
   * having tried), and the gates reject before the amount is even read,
   * so any verified account can otherwise write rows as fast as it can
   * post.
   *
   * Set far above human behaviour on purpose. Refusing a genuine bid in
   * the closing seconds is a far worse failure than absorbing a burst,
   * and one a second is already frantic clicking.
   */
  bidsPerUserMinute: { max: 60, windowMs: 60 * 1000 },
} as const satisfies Record<string, Limit>;

/**
 * Record a hit and report whether the caller is over the limit.
 *
 * Counts the attempt regardless of outcome — limiting only failures
 * would let an attacker with a working script run unbounded.
 *
 * Insert and count in one statement, so a burst of concurrent requests
 * cannot each read the count before any of them has written. The CTE's
 * insert is not visible to the count beside it — same snapshot — so the
 * new row is added back explicitly rather than being counted twice or
 * not at all.
 *
 * Throws if the database is unreachable, and deliberately does not
 * swallow it: failing open would remove the control at exactly the
 * moment the system is least healthy.
 */
export async function hit(
  scope: string,
  value: string,
  limit: Limit,
  now: Date = new Date(),
): Promise<boolean> {
  const key = keyFor(scope, value);
  const cutoff = new Date(now.getTime() - limit.windowMs);

  const [row] = await prisma.$queryRaw<{ total: bigint }[]>`
    WITH inserted AS (
      INSERT INTO rate_limit_hits (key, hit_at) VALUES (${key}, ${now}) RETURNING 1 AS one
    )
    SELECT (SELECT count(*) FROM rate_limit_hits WHERE key = ${key} AND hit_at > ${cutoff})
         + (SELECT count(*) FROM inserted) AS total
  `;

  return Number(row.total) > limit.max;
}

/** Test seam. Empties the store outright. */
export async function reset(): Promise<void> {
  await prisma.rateLimitHit.deleteMany();
}

/**
 * Drop hits that no window can still care about.
 *
 * In memory this bounded a leak; in Postgres it bounds a table. Nothing
 * ever called it before, which was survivable for a Map that died with
 * the process and is not for rows on a disk.
 */
export async function evictExpired(now: Date = new Date()): Promise<number> {
  const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
  const { count } = await prisma.rateLimitHit.deleteMany({
    where: { hitAt: { lte: new Date(now.getTime() - longest) } },
  });
  return count;
}

/*
 * The sweep is cheap but not free, and the worker calls its endpoint
 * every few seconds. This keeps it to roughly one sweep an hour per
 * instance.
 *
 * Per-instance state, deliberately: it is an optimisation, not a lock.
 * Two instances sweeping at once both issue the same idempotent DELETE
 * and the second one finds nothing to do.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastSweptAt = 0;

export async function evictExpiredIfDue(now: Date = new Date()): Promise<number | null> {
  if (now.getTime() - lastSweptAt < SWEEP_INTERVAL_MS) return null;
  lastSweptAt = now.getTime();
  return evictExpired(now);
}
