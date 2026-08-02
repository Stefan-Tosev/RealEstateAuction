import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/server/identity/password";

const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminUser: { findUnique },
  },
}));

const { verifyAdminCredentials } = await import("@/server/identity/admin-users");

describe("verifyAdminCredentials", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("returns the admin when email and password match", async () => {
    const passwordHash = await hashPassword("s3cret-password");
    findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@auctionhouse.test",
      passwordHash,
      name: "Admin",
      role: "admin",
    });

    const result = await verifyAdminCredentials("admin@auctionhouse.test", "s3cret-password");

    expect(result?.id).toBe("admin-1");
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "admin@auctionhouse.test" } });
  });

  it("returns null for a wrong password", async () => {
    const passwordHash = await hashPassword("s3cret-password");
    findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@auctionhouse.test",
      passwordHash,
      name: "Admin",
      role: "admin",
    });

    const result = await verifyAdminCredentials("admin@auctionhouse.test", "wrong-password");

    expect(result).toBeNull();
  });

  it("returns null for an unknown email without hashing anything", async () => {
    findUnique.mockResolvedValue(null);

    const result = await verifyAdminCredentials("nobody@auctionhouse.test", "whatever");

    expect(result).toBeNull();
  });
});
