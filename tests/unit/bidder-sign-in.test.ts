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
     * password costs ~31ms.
     */
    const time = async (email: string) => {
      const t0 = performance.now();
      await verifyBidderCredentials(email, "some-wrong-password");
      return performance.now() - t0;
    };

    const existing = await time(emails.verified);
    const missing = await time(`${PREFIX}nobody@example.bg`);

    const ratio = Math.max(existing, missing) / Math.max(Math.min(existing, missing), 0.01);
    expect(ratio).toBeLessThan(5);
  });

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
