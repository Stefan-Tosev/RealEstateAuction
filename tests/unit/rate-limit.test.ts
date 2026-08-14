import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { evictExpired, hit, LIMITS, reset } from "@/server/identity/rate-limit";

/*
 * The limiter moved from an in-memory Map to Postgres, per
 * docs/open-items.md §3.5: the Map held for one box, so a second
 * instance handed out the allowance twice and a restart cleared it.
 *
 * These run against the real database, like the rest of the suite.
 */

const limit = { max: 3, windowMs: 60 * 60 * 1000 };

beforeEach(async () => {
  await reset();
});

afterEach(async () => {
  await reset();
});

describe("hit", () => {
  it("allows exactly max attempts and refuses the next", async () => {
    for (let i = 1; i <= limit.max; i += 1) {
      expect(await hit("test:allow", "192.0.2.1", limit), `attempt ${i}`).toBe(false);
    }
    expect(await hit("test:allow", "192.0.2.1", limit)).toBe(true);
  });

  it("counts the attempt whatever its outcome", async () => {
    /*
     * Limiting only failures would let an attacker with a working script
     * run unbounded — the point is to cap attempts, not mistakes.
     */
    await hit("test:count", "192.0.2.2", limit);
    await hit("test:count", "192.0.2.2", limit);
    expect(await prisma.rateLimitHit.count()).toBe(2);
  });

  it("keeps separate counts per value and per scope", async () => {
    for (let i = 0; i < limit.max + 1; i += 1) await hit("test:a", "first", limit);

    // A different value under the same scope is untouched...
    expect(await hit("test:a", "second", limit)).toBe(false);
    // ...as is the same value under a different scope.
    expect(await hit("test:b", "first", limit)).toBe(false);
  });

  it("stores no plaintext identifier", async () => {
    /*
     * server-validation §6: the store must not become a list of everyone
     * who ever tried. The key is an HMAC of the address, not the address.
     */
    const email = "someone@example.com";
    await hit("test:hash", email, limit);

    const rows = await prisma.rateLimitHit.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).not.toContain(email);
    expect(rows[0].key).not.toContain("example.com");
    expect(rows[0].key).toMatch(/^test:hash:[0-9a-f]{64}$/);
  });

  it("is case-insensitive about the value", async () => {
    // Otherwise Someone@Example.com buys a fresh allowance.
    for (let i = 0; i < limit.max; i += 1) await hit("test:case", "user@example.com", limit);
    expect(await hit("test:case", "USER@EXAMPLE.COM", limit)).toBe(true);
  });
});

describe("the window slides", () => {
  it("forgets hits that fall out of the window", async () => {
    const start = new Date("2026-08-14T10:00:00Z");

    for (let i = 0; i < limit.max; i += 1) {
      await hit("test:slide", "192.0.2.3", limit, start);
    }
    expect(await hit("test:slide", "192.0.2.3", limit, start)).toBe(true);

    // An hour and a second later the original hits are outside the window.
    const later = new Date(start.getTime() + limit.windowMs + 1000);
    expect(await hit("test:slide", "192.0.2.3", limit, later)).toBe(false);
  });

  it("does not reset on a boundary the way a counter would", async () => {
    /*
     * The reason this is a row per hit rather than a counter column. A
     * counter that resets on the hour lets max through either side of
     * the boundary — 2 * max inside a few minutes.
     */
    const base = new Date("2026-08-14T10:59:00Z");
    for (let i = 0; i < limit.max; i += 1) await hit("test:boundary", "ip", limit, base);

    const justAfterTheHour = new Date("2026-08-14T11:01:00Z");
    expect(await hit("test:boundary", "ip", limit, justAfterTheHour)).toBe(true);
  });
});

describe("eviction", () => {
  it("drops only rows no window can still care about", async () => {
    const now = new Date("2026-08-14T12:00:00Z");
    const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));

    await hit("test:old", "ip", limit, new Date(now.getTime() - longest - 60_000));
    await hit("test:new", "ip", limit, now);

    expect(await evictExpired(now)).toBe(1);

    const remaining = await prisma.rateLimitHit.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].key).toMatch(/^test:new:/);
  });
});

describe("the configured limits", () => {
  it("matches server-validation §6", async () => {
    expect(LIMITS.registrationPerIpHour).toEqual({ max: 5, windowMs: 3_600_000 });
    expect(LIMITS.registrationPerIpDay).toEqual({ max: 20, windowMs: 86_400_000 });
    expect(LIMITS.registrationPerEmailHour).toEqual({ max: 3, windowMs: 3_600_000 });
  });

  it("sets the bid limit far above human behaviour", async () => {
    /*
     * Refusing a genuine bid in the closing seconds is a far worse
     * failure than absorbing a burst.
     */
    expect(LIMITS.bidsPerUserMinute.max).toBeGreaterThanOrEqual(60);
  });
});
