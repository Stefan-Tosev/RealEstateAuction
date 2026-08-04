import { describe, expect, it, vi } from "vitest";

/*
 * The boundary between operator and bidder sessions.
 *
 * One Auth.js instance serves both, so "there is a valid session" proves
 * someone is signed in — not that they are staff. These tests exist to
 * make a regression here loud, because the failure mode is a bidder
 * reaching the admin area rather than an error anyone would notice.
 */

const authMock = vi.fn();
vi.mock("@/server/identity/auth", () => ({ auth: () => authMock() }));

const { currentAdmin, currentBidder, requireAdmin, requireBidder, requireRoleFor, AuthorizationError } =
  await import("@/server/identity/authz");

const adminSession = {
  user: { id: "admin-1", email: "ops@auctionhouse.test", kind: "admin", role: "admin" },
};
const staffSession = {
  user: { id: "staff-1", email: "staff@auctionhouse.test", kind: "admin", role: "staff" },
};
const bidderSession = {
  user: { id: "bidder-1", email: "bidder@example.bg", kind: "bidder" },
};

describe("operator sessions", () => {
  it("resolves for an admin and a staff account", async () => {
    authMock.mockResolvedValue(adminSession);
    await expect(currentAdmin()).resolves.toMatchObject({ id: "admin-1", role: "admin" });

    authMock.mockResolvedValue(staffSession);
    await expect(currentAdmin()).resolves.toMatchObject({ role: "staff" });
  });

  it("does not resolve for a bidder", async () => {
    // The assertion this whole design exists for.
    authMock.mockResolvedValue(bidderSession);
    await expect(currentAdmin()).resolves.toBeNull();
    await expect(requireAdmin()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses a bidder even if a role somehow appears on the session", async () => {
    /*
     * The classic version of this bug: authority inferred from a role
     * field being present. `kind` is asserted, so a forged or
     * accidentally-populated role changes nothing.
     */
    authMock.mockResolvedValue({
      user: { id: "bidder-2", email: "b@example.bg", kind: "bidder", role: "admin" },
    });

    await expect(currentAdmin()).resolves.toBeNull();
    await expect(requireRoleFor("lot.publish")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses a session with no kind at all", async () => {
    // An old token issued before `kind` existed must not be trusted.
    authMock.mockResolvedValue({ user: { id: "x", email: "x@y.z", role: "admin" } });
    await expect(currentAdmin()).resolves.toBeNull();
  });
});

describe("bidder sessions", () => {
  it("resolves for a bidder", async () => {
    authMock.mockResolvedValue(bidderSession);
    await expect(currentBidder()).resolves.toMatchObject({ id: "bidder-1" });
  });

  it("does not resolve for an operator", async () => {
    // Symmetrical: staff browsing the public site are not a bidder, and
    // must not be able to book a viewing or bid as one.
    authMock.mockResolvedValue(adminSession);
    await expect(currentBidder()).resolves.toBeNull();
    await expect(requireBidder()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("does not resolve when signed out", async () => {
    authMock.mockResolvedValue(null);
    await expect(currentBidder()).resolves.toBeNull();
  });
});
