import { describe, expect, it, vi } from "vitest";

/*
 * Role enforcement lives on the server, not in the disabled attribute of
 * a button. The e2e suite checks the button; this checks the rule that
 * actually holds when someone posts to the action directly.
 */

const authMock = vi.fn();
vi.mock("@/server/identity/auth", () => ({ auth: () => authMock() }));

const { ADMIN_ONLY_ACTIONS, AuthorizationError, canPerform, currentAdmin, requireAdmin, requireRoleFor } =
  await import("@/server/identity/authz");

function session(role: "admin" | "staff") {
  return { user: { id: `${role}-id`, email: `${role}@auctionhouse.test`, name: role, role } };
}

describe("canPerform", () => {
  it("lets an admin do anything", () => {
    for (const action of ADMIN_ONLY_ACTIONS) {
      expect(canPerform("admin", action)).toBe(true);
    }
  });

  it("refuses staff the auctioneer's acts", () => {
    /*
     * architecture §10: "The auctioneer must agree the reserve. Sellers
     * do not set it unilaterally." Agreeing a reserve and putting a lot
     * live are commercial commitments, not data entry.
     */
    expect(canPerform("staff", "lot.agreeReserve")).toBe(false);
    expect(canPerform("staff", "lot.publish")).toBe(false);
    expect(canPerform("staff", "lot.cancel")).toBe(false);
    expect(canPerform("staff", "lot.editLive")).toBe(false);
  });

  it("leaves the day-to-day work to staff", () => {
    // Drafting, copy and photography are the whole point of the role.
    expect(canPerform("staff", "property.create")).toBe(true);
    expect(canPerform("staff", "image.add")).toBe(true);
    expect(canPerform("staff", "lot.create")).toBe(true);
  });
});

describe("requireAdmin", () => {
  it("returns the actor when signed in", async () => {
    authMock.mockResolvedValue(session("staff"));
    await expect(requireAdmin()).resolves.toMatchObject({ role: "staff" });
  });

  it("throws rather than returning null, so a caller cannot forget to check", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("treats a session without a role as unauthenticated", async () => {
    // A malformed or half-populated session must not read as permission.
    authMock.mockResolvedValue({ user: { id: "x", email: "x@y.z" } });
    await expect(currentAdmin()).resolves.toBeNull();
  });
});

describe("requireRoleFor", () => {
  it("permits an admin", async () => {
    authMock.mockResolvedValue(session("admin"));
    await expect(requireRoleFor("lot.publish")).resolves.toMatchObject({ role: "admin" });
  });

  it("refuses staff at the server, regardless of what the UI showed", async () => {
    authMock.mockResolvedValue(session("staff"));
    await expect(requireRoleFor("lot.publish")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(requireRoleFor("lot.agreeReserve")).rejects.toThrow(/auctioneer/i);
  });

  it("refuses an anonymous caller", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireRoleFor("lot.publish")).rejects.toBeInstanceOf(AuthorizationError);
  });
});
