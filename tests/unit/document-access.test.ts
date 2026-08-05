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

const { canAccess, describeForViewer } = await import("@/server/documents/access");

const DOCUMENT = {
  id: "doc-1",
  kind: "encumbrances" as const,
  visibility: "registered" as const,
  size: 240_000n,
  mime: "application/pdf",
  // Real filenames carry addresses, owner names and case numbers.
  filename: "тежести-ул-Съборна-14-Петров.pdf",
};

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

describe("what a viewer is told about a document they cannot open", () => {
  it("shows an anonymous visitor the kind but not the filename", async () => {
    /*
     * The gate exists to capture leads (§5). Someone who cannot see that
     * a pack exists has no reason to register for it, so hiding the
     * listing would make the tier pointless.
     *
     * Kinds are safe: every lot has an encumbrances certificate.
     * Filenames are not — they carry addresses and owner names.
     */
    const listed = await describeForViewer(DOCUMENT, { kind: "anonymous" });

    expect(listed.kind).toBe("encumbrances");
    expect(listed.sizeBytes).toBe(240_000);
    expect(listed.downloadable).toBe(false);
    expect(listed.reason).toBe("sign-in-required");
    expect(listed.filename).toBeNull();
  });

  it("does not leak the filename anywhere in the payload", async () => {
    // Guards against the name reappearing through some other field.
    const listed = await describeForViewer(DOCUMENT, { kind: "anonymous" });

    expect(JSON.stringify(listed)).not.toContain("Съборна");
    expect(JSON.stringify(listed)).not.toContain("Петров");
  });

  it("reveals the filename once the viewer can download it", async () => {
    const listed = await describeForViewer(DOCUMENT, { kind: "bidder", userId: "u1" });

    expect(listed.downloadable).toBe(true);
    expect(listed.filename).toBe(DOCUMENT.filename);
    expect(listed.reason).toBeUndefined();
  });

  it("tells a signed-in bidder that approval is what is missing", async () => {
    // "Sign in" and "get approved" are different asks; saying which one
    // is the difference between a lead and a dead end.
    approvalCount = 0;
    const listed = await describeForViewer(
      { ...DOCUMENT, visibility: "approved_bidders" },
      { kind: "bidder", userId: "u1" },
    );

    expect(listed.downloadable).toBe(false);
    expect(listed.reason).toBe("approval-required");
    expect(listed.filename).toBeNull();
  });

  it("converts the bigint size, which would not survive serialization", async () => {
    const listed = await describeForViewer(DOCUMENT, { kind: "admin" });
    expect(typeof listed.sizeBytes).toBe("number");
    expect(() => JSON.stringify(listed)).not.toThrow();
  });
});
