import { createHmac } from "node:crypto";

/*
 * Rate limiting, per docs/server-validation.md §6.
 *
 * In-memory and therefore per-instance: this holds for one box, which is
 * what the deployment is today. It is NOT a distributed limiter, and the
 * moment there are two instances it must move to Redis or Postgres —
 * flagged here rather than discovered under load.
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

type Bucket = { hits: number[]; };

const buckets = new Map<string, Bucket>();

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
 */
export function hit(scope: string, value: string, limit: Limit, now = Date.now()): boolean {
  const key = keyFor(scope, value);
  const bucket = buckets.get(key) ?? { hits: [] };

  const cutoff = now - limit.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  bucket.hits.push(now);
  buckets.set(key, bucket);

  return bucket.hits.length > limit.max;
}

/** Test seam; also lets a long-lived process shed memory. */
export function reset(): void {
  buckets.clear();
}

/*
 * Bound memory. Without this a long-running process accumulates a bucket
 * per distinct IP and email forever, which is a slow leak and, worse, an
 * ever-growing store of (hashed) identifiers.
 */
export function evictExpired(now = Date.now()): void {
  const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
  for (const [key, bucket] of buckets) {
    if (bucket.hits.every((t) => t <= now - longest)) buckets.delete(key);
  }
}
