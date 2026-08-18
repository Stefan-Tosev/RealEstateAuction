import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyBidderCredentials } from "@/server/identity/bidder-users";
import { hashPassword } from "@/server/identity/password";

/*
 * Bidder sign-in against the real users table.
 *
 * The rules that matter here are: an unverified address cannot sign in,
 * a suspended one cannot either, and the timing does not reveal which
 * addresses exist.
 */

const prisma = new PrismaClient();
const PREFIX = "vitest-signin-";
const PASSWORD = "granite harbour lantern fold";

const emails = {
  verified: `${PREFIX}verified@example.bg`,
  unverified: `${PREFIX}unverified@example.bg`,
  suspended: `${PREFIX}suspended@example.bg`,
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const base = {
    passwordHash,
    firstName: "Иван",
    lastName: "Петров",
    dateOfBirth: new Date("1990-01-01"),
    accountType: "individual" as const,
  };

  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.user.createMany({
    data: [
      { ...base, email: emails.verified, emailVerifiedAt: new Date() },
      { ...base, email: emails.unverified },
      { ...base, email: emails.suspended, emailVerifiedAt: new Date(), status: "suspended" },
    ],
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("verifyBidderCredentials", () => {
  it("signs in a verified account", async () => {
    await expect(verifyBidderCredentials(emails.verified, PASSWORD)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("is case-insensitive on the address", async () => {
    // The column is citext; nothing is lowercased for storage.
    await expect(
      verifyBidderCredentials(emails.verified.toUpperCase(), PASSWORD),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses a wrong password", async () => {
    await expect(verifyBidderCredentials(emails.verified, "wrong-password")).resolves.toMatchObject(
      { ok: false, reason: "invalid" },
    );
  });

  it("refuses an unverified address", async () => {
    /*
     * Without this the verification step is decorative: anyone could
     * register with someone else's address and use the account.
     */
    await expect(verifyBidderCredentials(emails.unverified, PASSWORD)).resolves.toMatchObject({
      ok: false,
      reason: "unverified",
    });
  });

  it("refuses a suspended account", async () => {
    await expect(verifyBidderCredentials(emails.suspended, PASSWORD)).resolves.toMatchObject({
      ok: false,
      reason: "suspended",
    });
  });

  it("costs comparable time whether or not the address exists", async () => {
    /*
     * Same enumeration oracle the admin login had: skipping the Argon2
     * verify for an unknown address returns in ~0ms while a wrong
     * password costs ~36ms. verifyBidderCredentials avoids it by
     * verifying against a dummy hash when there is no user, so both
     * paths pay for one Argon2 verification.
     *
     * Medians of several samples, not one pair each. A single pair was
     * what this asserted before, and on 18 August 2026 it failed in CI
     * at 9.27 against a bound of 5 while the property was completely
     * intact: one call had stalled under parallel load. Measured idle,
     * the two paths sit at p50 36.6ms and 36.0ms — a median ratio of
     * 1.016 — but individual samples range 32ms to 48ms here and much
     * wider on a loaded CI runner.
     *
     * That mattered more than an ordinary flake. This assertion guards a
     * security property, and a test that cries wolf is one whose
     * failures get waved through; the one time it was right would have
     * looked exactly like the times it was wrong.
     *
     * The warm-up is not padding. getDummyHash() is computed lazily and
     * cached, so the first unknown-address call pays an extra hash and
     * runs *slower* — the wrong direction for a leak, but noise either
     * way.
     */
    const time = async (email: string) => {
      const t0 = performance.now();
      await verifyBidderCredentials(email, "some-wrong-password");
      return performance.now() - t0;
    };

    const missingEmail = `${PREFIX}nobody@example.bg`;

    await time(emails.verified);
    await time(missingEmail);

    const existing: number[] = [];
    const missing: number[] = [];
    for (let i = 0; i < 7; i++) {
      existing.push(await time(emails.verified));
      missing.push(await time(missingEmail));
    }

    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const e = median(existing);
    const m = median(missing);
    const ratio = Math.max(e, m) / Math.max(Math.min(e, m), 0.01);

    /*
     * Bound at 2 rather than 5. A real oracle is not a near miss — the
     * unknown path would skip Argon2 entirely and return in about a
     * millisecond against 36, a ratio in the tens. Tightening the bound
     * while widening the sample makes the assertion both stricter about
     * the thing it guards and quieter about the thing it does not.
     */
    expect(ratio).toBeLessThan(2);
  }, 30_000);

  it("applies NFKC so a password normalises the same way it was hashed", async () => {
    // Composed vs decomposed accents look identical on screen; without
    // matching normalisation the user is locked out invisibly.
    const email = `${PREFIX}nfkc@example.bg`;
    /*
     * Built from escapes, not literals: an editor or tool that
     * normalises the source file would silently make both strings
     * identical and turn this test into a no-op that always passes.
     */
    const decomposed = "cafe" + String.fromCodePoint(0x0301) + " harbour lantern"; // e + combining acute
    const composed = decomposed.normalize("NFC"); // single code point
    expect(composed).not.toBe(decomposed);

    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(composed.normalize("NFKC")),
        firstName: "Test",
        lastName: "User",
        dateOfBirth: new Date("1990-01-01"),
        accountType: "individual",
        emailVerifiedAt: new Date(),
      },
    });

    await expect(verifyBidderCredentials(email, decomposed)).resolves.toMatchObject({ ok: true });
  });
});
