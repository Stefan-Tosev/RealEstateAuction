import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { issueFormToken } from "@/server/identity/form-token";
import { POLICY_VERSION, register } from "@/server/identity/registration";

/*
 * Registration, tested at the service level rather than over HTTP.
 *
 * That is deliberate: the rate limiter allows 5 registrations per hour
 * per IP (§6), which makes the enumeration property — the one §5 calls
 * "the rule most implementations get wrong" — impossible to measure
 * through the endpoint. Testing below the limiter lets both be checked
 * properly, each where it actually lives.
 *
 * Hits the real database, and cleans up after itself.
 */

const prisma = new PrismaClient();
const PREFIX = "vitest-reg-";

const CONTEXT = {
  ip: "203.0.113.10",
  userAgent: "vitest",
  wording: { terms: "I agree to the terms.", marketing: "Send me lot notifications." },
  baseUrl: "http://localhost:3000",
};

function dobYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    accountType: "individual",
    firstName: "Иван",
    lastName: "Петров",
    email: `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.bg`,
    phone: "0888123456",
    dateOfBirth: dobYearsAgo(30),
    companyName: null,
    eik: null,
    vat: null,
    password: "granite harbour lantern fold",
    terms: true,
    marketing: false,
    website: "",
    // Issued 5s ago so it clears the 2s time gate (§6).
    formToken: issueFormToken(Date.now() - 5_000),
    ...overrides,
  };
}

beforeEach(() => {
  // Keep the breach check off the network so timings measure our own
  // work rather than HIBP's latency.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
});

afterAll(async () => {
  /*
   * Outbox rows take Prisma's default onDelete: Restrict, so they have
   * to go before the user. Consents and verification tokens cascade.
   *
   * Worth noting beyond this test: any future "delete my account" flow
   * hits the same constraint, and per §7 that flow must anonymise while
   * preserving AML records rather than cascade-delete anyway.
   */
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.$disconnect();
  vi.restoreAllMocks();
});

describe("a valid registration", () => {
  it("accepts and persists the account unverified", async () => {
    const data = input();
    await expect(register(data, CONTEXT)).resolves.toEqual({ status: "pending_verification" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: String(data.email) },
      include: { consents: true, verificationTokens: true, outboxEntries: true },
    });

    // Unverified until the emailed link is followed.
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.firstName).toBe("Иван");
    // Normalised to E.164 before storage.
    expect(user.phone).toBe("+359888123456");
    expect(user.verificationTokens).toHaveLength(1);
    // Only the hash is stored — SHA-256 hex is 64 characters.
    expect(user.verificationTokens[0].tokenHash).toHaveLength(64);
    expect(user.outboxEntries.map((o) => o.template)).toContain("verify_email");
  });

  it("records both consents with version and exact wording", async () => {
    const data = input({ marketing: true });
    await register(data, CONTEXT);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: String(data.email) },
      include: { consents: true },
    });

    const terms = user.consents.find((c) => c.kind === "terms");
    const marketing = user.consents.find((c) => c.kind === "marketing");

    // "User accepted terms" without the version is unusable in a dispute.
    expect(terms).toMatchObject({ granted: true, policyVersion: POLICY_VERSION });
    expect(terms?.wording).toBe(CONTEXT.wording.terms);
    expect(terms?.ip).toBe(CONTEXT.ip);
    expect(marketing).toMatchObject({ granted: true });
  });

  it("records a declined marketing consent rather than omitting it", async () => {
    // A refusal is itself a fact worth being able to prove.
    const data = input({ marketing: false });
    await register(data, CONTEXT);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: String(data.email) },
      include: { consents: true },
    });

    expect(user.consents.find((c) => c.kind === "marketing")).toMatchObject({ granted: false });
  });

  it("stores the date of birth, not a computed age", async () => {
    const data = input();
    await register(data, CONTEXT);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: String(data.email) } });
    expect(user.dateOfBirth.toISOString().slice(0, 10)).toBe(data.dateOfBirth);
  });
});

describe("account enumeration (§5)", () => {
  it("returns the identical result for a duplicate address", async () => {
    const data = input();
    await register(data, CONTEXT);

    // Same address again — must be indistinguishable from a new one.
    const second = await register(input({ email: data.email }), CONTEXT);
    expect(second).toEqual({ status: "pending_verification" });

    // And must not have created a second account.
    expect(await prisma.user.count({ where: { email: String(data.email) } })).toBe(1);
  });

  it("takes comparable time whether or not the address exists", async () => {
    const existing = input();
    await register(existing, CONTEXT);

    const time = async (data: ReturnType<typeof input>) => {
      const t0 = performance.now();
      await register(data, CONTEXT);
      return performance.now() - t0;
    };

    // Two samples each, alternating, so drift affects both equally.
    const dupeA = await time(input({ email: existing.email }));
    const freshA = await time(input());
    const dupeB = await time(input({ email: existing.email }));
    const freshB = await time(input());

    const dupe = (dupeA + dupeB) / 2;
    const fresh = (freshA + freshB) / 2;

    /*
     * A fast "success" versus a slow one is a working oracle regardless
     * of the response body. Both paths do the Argon2id work and are
     * padded to a common floor.
     */
    expect(Math.abs(dupe - fresh)).toBeLessThan(250);
  }, 30_000);
});

describe("rejections", () => {
  it("refuses terms that are not exactly boolean true", async () => {
    // Truthiness is not consent.
    for (const value of ["true", 1, "on", null]) {
      const result = await register(input({ terms: value }), CONTEXT);
      expect(result, String(value)).toMatchObject({ status: "invalid" });
      if (result.status === "invalid") {
        expect(result.errors).toContainEqual({ field: "terms", code: "NOT_ACCEPTED" });
      }
    }
  });

  it("refuses an underage applicant but accepts one who turns 18 today", async () => {
    const tooYoung = await register(input({ dateOfBirth: dobYearsAgo(17) }), CONTEXT);
    expect(tooYoung).toMatchObject({ status: "invalid" });

    // The case naive UTC arithmetic gets wrong.
    const eighteenToday = await register(input({ dateOfBirth: dobYearsAgo(18) }), CONTEXT);
    expect(eighteenToday).toEqual({ status: "pending_verification" });
  });

  it("refuses a company without a valid ЕИК", async () => {
    const result = await register(
      input({ accountType: "company", companyName: "Тест ЕООД", eik: "831641719" }),
      CONTEXT,
    );
    expect(result).toMatchObject({ status: "invalid" });
    if (result.status === "invalid") {
      expect(result.errors).toContainEqual({ field: "eik", code: "CHECKSUM_FAILED" });
    }
  });

  it("returns codes, never prose", async () => {
    // The API is locale-agnostic; the client owns the copy so it can
    // render both languages.
    const result = await register(input({ terms: false, password: "short" }), CONTEXT);
    if (result.status !== "invalid") throw new Error("expected invalid");

    for (const error of result.errors) {
      expect(error.code).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("company fields", () => {
  it("discards company data submitted by an individual", async () => {
    /*
     * §3: "Never trust accountType to decide what to store." Persisting
     * unvalidated company fields because the client said "individual"
     * is how bad data gets in.
     */
    const data = input({
      accountType: "individual",
      companyName: "Should Not Persist",
      eik: "831641791",
      vat: "BG831641791",
    });
    await register(data, CONTEXT);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: String(data.email) } });
    expect(user.companyName).toBeNull();
    expect(user.eik).toBeNull();
    expect(user.vat).toBeNull();
  });
});

describe("time gate (§6)", () => {
  it("silently discards a submission made too fast", async () => {
    /*
     * A token issued this instant means the form came back in under the
     * 2s minimum fill time. Same silent-discard path as the honeypot:
     * the ordinary success shape, and nothing created.
     */
    const data = input({ formToken: issueFormToken(Date.now()) });

    await expect(register(data, CONTEXT)).resolves.toEqual({ status: "pending_verification" });
    expect(await prisma.user.count({ where: { email: String(data.email) } })).toBe(0);
  });

  it("silently discards a forged token", async () => {
    // HMAC-signed, so a bot cannot simply invent an older timestamp —
    // which is why a client-measured "seconds since load" would be
    // worthless here.
    const forged = `${Date.now() - 60_000}.not-a-real-signature`;
    const data = input({ formToken: forged });

    await expect(register(data, CONTEXT)).resolves.toEqual({ status: "pending_verification" });
    expect(await prisma.user.count({ where: { email: String(data.email) } })).toBe(0);
  });

  it("tells a person their form expired rather than pretending it worked", async () => {
    // Someone who left the tab open overnight deserves to be told to
    // reload, not to believe they registered.
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    const result = await register(input({ formToken: issueFormToken(threeHoursAgo) }), CONTEXT);

    expect(result).toMatchObject({ status: "invalid" });
    if (result.status === "invalid") {
      expect(result.errors).toContainEqual({ field: "_form", code: "FORM_EXPIRED" });
    }
  });

  it("refuses a submission carrying no token at all", async () => {
    const result = await register(input({ formToken: undefined }), CONTEXT);
    expect(result).toMatchObject({ status: "invalid" });
  });
});

describe("honeypot (§6)", () => {
  it("looks like success but creates nothing", async () => {
    const data = input({ website: "http://spam.example" });

    // Never reveal the trap — the response is the ordinary one.
    await expect(register(data, CONTEXT)).resolves.toEqual({ status: "pending_verification" });
    expect(await prisma.user.count({ where: { email: String(data.email) } })).toBe(0);
  });
});
