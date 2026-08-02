import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminUser: { findUnique },
  },
}));

// Wrap the real implementations so we can assert that the Argon2 work
// actually happens on every path, without stubbing out the crypto.
vi.mock("@/server/identity/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/identity/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const { hashPassword, verifyPassword } = await import("@/server/identity/password");
const { verifyAdminCredentials } = await import("@/server/identity/admin-users");

describe("verifyAdminCredentials", () => {
  beforeEach(() => {
    findUnique.mockReset();
    vi.mocked(verifyPassword).mockClear();
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

  it("returns null for an unknown email", async () => {
    findUnique.mockResolvedValue(null);

    const result = await verifyAdminCredentials("nobody@auctionhouse.test", "whatever");

    expect(result).toBeNull();
  });

  /*
   * Enumeration defence. Skipping the Argon2 verify when no account
   * matches returns in ~0ms, while a wrong password costs ~31ms — a
   * timing oracle that reveals which admin addresses exist no matter
   * how generic the error message is.
   *
   * docs/server-validation.md §4: "Hash with a constant-cost path even
   * when the request is going to fail for other reasons."
   */
  it("still performs the password verification when no account matches", async () => {
    findUnique.mockResolvedValue(null);

    await verifyAdminCredentials("nobody@auctionhouse.test", "whatever");

    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("costs comparable time whether or not the account exists", async () => {
    const passwordHash = await hashPassword("s3cret-password");

    findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@auctionhouse.test",
      passwordHash,
      name: "Admin",
      role: "admin",
    });
    const startExisting = performance.now();
    await verifyAdminCredentials("admin@auctionhouse.test", "wrong-password");
    const existingMs = performance.now() - startExisting;

    findUnique.mockResolvedValue(null);
    const startMissing = performance.now();
    await verifyAdminCredentials("nobody@auctionhouse.test", "wrong-password");
    const missingMs = performance.now() - startMissing;

    // Generous bound: catches the ~31ms-vs-0ms regression without
    // being flaky about ordinary scheduling jitter.
    const ratio = Math.max(existingMs, missingMs) / Math.max(Math.min(existingMs, missingMs), 0.01);
    expect(ratio).toBeLessThan(5);
  });
});
