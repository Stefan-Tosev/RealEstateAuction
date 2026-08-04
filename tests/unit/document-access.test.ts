import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The visibility tiers from docs/architecture.md §5.
 *
 * In its own file with a single hoisted mock, rather than alongside the
 * other document tests: vi.doMock does not re-apply once a module is in
 * the registry, so per-test mocks of the same import silently reuse the
 * first one and every case appears to agree with it.
 */

let approvalCount = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: { bidderApproval: { count: async () => approvalCount } },
}));

const { canAccess, visibilitiesFor } = await import("@/server/documents/access");

beforeEach(() => {
  approvalCount = 0;
});

describe("public tier", () => {
  it("is available to anyone", async () => {
    // Headline info is public; that is what draws people in.
    await expect(canAccess("public", { kind: "anonymous" })).resolves.toMatchObject({
      allowed: true,
    });
    await expect(canAccess("public", { kind: "bidder", userId: "u1" })).resolves.toMatchObject({
      allowed: true,
    });
  });
});

describe("registered tier", () => {
  it("requires signing in", async () => {
    /*
     * §5: "the full pack requires registration. That captures serious
     * leads and gives you a demand signal before anyone bids."
     */
    await expect(canAccess("registered", { kind: "anonymous" })).resolves.toMatchObject({
      allowed: false,
      reason: "sign-in-required",
    });
  });

  it("is available to any signed-in bidder", async () => {
    await expect(canAccess("registered", { kind: "bidder", userId: "u1" })).resolves.toMatchObject({
      allowed: true,
    });
  });
});

describe("approved-bidders tier", () => {
  it("is currently reachable by nobody", async () => {
    /*
     * Nothing sets BidderApproval — manual approval is Phase 2. This
     * tier is therefore visible to no bidder today, and that is the
     * honest behaviour: silently treating "registered" as sufficient
     * would disclose documents an operator specifically restricted.
     */
    approvalCount = 0;

    await expect(
      canAccess("approved_bidders", { kind: "bidder", userId: "u1" }),
    ).resolves.toMatchObject({ allowed: false, reason: "approval-required" });
  });

  it("opens once an approval row exists", async () => {
    // Proves the gate is the approval, not the phase — Phase 2 will not
    // need to change this code, only to start writing the rows.
    approvalCount = 1;

    await expect(
      canAccess("approved_bidders", { kind: "bidder", userId: "u1" }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("asks an anonymous visitor to sign in first", async () => {
    await expect(canAccess("approved_bidders", { kind: "anonymous" })).resolves.toMatchObject({
      allowed: false,
      reason: "sign-in-required",
    });
  });
});

describe("operators", () => {
  it("see every tier", async () => {
    // They uploaded them.
    for (const tier of ["public", "registered", "approved_bidders"] as const) {
      await expect(canAccess(tier, { kind: "admin" })).resolves.toMatchObject({ allowed: true });
    }
  });
});

describe("what may be listed", () => {
  it("shows an anonymous visitor only public documents", async () => {
    // Listing is itself a disclosure: knowing a lot has an encumbrances
    // certificate is information about the lot.
    expect(visibilitiesFor({ kind: "anonymous" })).toEqual(["public"]);
  });

  it("lets a signed-in bidder see the full index", async () => {
    // They can see that a restricted document exists; whether they can
    // download it is a separate question, answered by canAccess.
    expect(visibilitiesFor({ kind: "bidder", userId: "u1" })).toContain("approved_bidders");
  });
});
