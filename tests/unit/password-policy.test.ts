import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkBreached,
  checkPassword,
  checkPasswordLocally,
  containsPersonal,
  MAX_LENGTH,
  MIN_LENGTH,
  normalisePassword,
} from "@/server/identity/password-policy";

/*
 * NIST SP 800-63B, via docs/server-validation.md §4. The point of these
 * tests is as much to stop someone re-adding composition rules later as
 * to prove the rules work now.
 */

const CONTEXT = { email: "ivanpetrov@example.bg", firstName: "Иван", lastName: "Петров" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("length", () => {
  it("requires at least 12 characters", () => {
    expect(checkPasswordLocally("elevenchars", CONTEXT)).toBe("TOO_SHORT");
    expect(checkPasswordLocally("a".repeat(MIN_LENGTH), CONTEXT)).toBeNull();
  });

  it("accepts a 64-character passphrase with spaces", () => {
    // Explicitly required by the spec. Spaces are legal characters.
    const passphrase = "correct horse battery staple correct horse battery staple abcdef";
    expect(passphrase.length).toBeGreaterThanOrEqual(64);
    expect(checkPasswordLocally(passphrase, CONTEXT)).toBeNull();
  });

  it("caps only to bound hashing cost", () => {
    expect(checkPasswordLocally("a".repeat(MAX_LENGTH), CONTEXT)).toBeNull();
    expect(checkPasswordLocally("a".repeat(MAX_LENGTH + 1), CONTEXT)).toBe("TOO_LONG");
  });

  it("measures code points, not UTF-16 units", () => {
    // 12 emoji are 24 UTF-16 units; counting units would let an
    // under-length password through as if it were long enough.
    const emoji = "🔑".repeat(12);
    expect(emoji.length).toBe(24);
    expect(checkPasswordLocally(emoji, CONTEXT)).toBeNull();

    expect(checkPasswordLocally("🔑".repeat(6), CONTEXT)).toBe("TOO_SHORT");
  });
});

describe("composition", () => {
  it("imposes no character-class rules at all", () => {
    /*
     * Guards against someone "hardening" this later. Composition rules
     * push people towards Password1! and away from passphrases.
     */
    for (const password of [
      "alllowercaseletters",
      "ALLUPPERCASELETTERS",
      "123456789012345678",
      "................",
      "всичко на кирилица",
    ]) {
      expect(checkPasswordLocally(password, CONTEXT), password).toBeNull();
    }
  });
});

describe("personal context", () => {
  it("rejects a password containing the email local part", () => {
    expect(containsPersonal("ivanpetrov-longenough", CONTEXT)).toBe(true);
    expect(checkPasswordLocally("ivanpetrov-longenough-x", CONTEXT)).toBe("CONTAINS_PERSONAL");
  });

  it("rejects a password containing either name, case-insensitively", () => {
    expect(containsPersonal("my-ИВАН-passphrase", CONTEXT)).toBe(true);
    expect(containsPersonal("my-петров-passphrase", CONTEXT)).toBe(true);
  });

  it("ignores fragments shorter than four characters", () => {
    // Forbidding every password containing a two-letter surname would
    // reject a great many good ones for no gain.
    expect(containsPersonal("a-perfectly-fine-passphrase", { lastName: "Li" })).toBe(false);
  });

  it("allows an unrelated passphrase", () => {
    expect(checkPasswordLocally("granite harbour lantern fold", CONTEXT)).toBeNull();
  });
});

describe("normalisation", () => {
  it("applies NFKC before hashing", () => {
    // Composed and decomposed forms look identical on screen; without
    // NFKC the user is locked out by something they cannot see.
    const composed = "café-passphrase-x";
    const decomposed = "café-passphrase-x";

    expect(composed).not.toBe(decomposed);
    expect(normalisePassword(composed)).toBe(normalisePassword(decomposed));
  });
});

describe("breach check", () => {
  it("sends only the first five SHA-1 characters, never the password", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("0000000000000000000000000000000000A:3", { status: 200 }),
    );

    const password = "correct horse battery staple";
    await checkBreached(password);

    const url = String(fetchMock.mock.calls[0][0]);
    // k-anonymity: the request must be a 5-character prefix and nothing more.
    expect(url).toMatch(/\/range\/[0-9A-F]{5}$/);
    expect(url).not.toContain(password);
    expect(url).not.toContain(encodeURIComponent(password));
  });

  it("flags a password whose suffix comes back with a non-zero count", async () => {
    const { createHash } = await import("node:crypto");
    const sha1 = createHash("sha1").update("hunter2hunter2", "utf8").digest("hex").toUpperCase();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`${sha1.slice(5)}:42\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:7`, { status: 200 }),
    );

    await expect(checkBreached("hunter2hunter2")).resolves.toMatchObject({
      checked: true,
      breached: true,
      count: 42,
    });
  });

  it("ignores padding decoys, which carry a count of zero", async () => {
    const { createHash } = await import("node:crypto");
    const sha1 = createHash("sha1").update("hunter2hunter2", "utf8").digest("hex").toUpperCase();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`${sha1.slice(5)}:0`, { status: 200 }),
    );

    await expect(checkBreached("hunter2hunter2")).resolves.toMatchObject({ breached: false });
  });

  it("fails open when the service is unreachable", async () => {
    /*
     * Deliberate. Refusing every signup while HIBP is down hands anyone
     * who can disrupt that one host the ability to close the auction
     * house's front door.
     */
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(checkBreached("granite harbour lantern")).resolves.toEqual({
      checked: false,
      breached: false,
      count: 0,
    });
  });

  it("fails open on a non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(checkBreached("granite harbour lantern")).resolves.toMatchObject({
      checked: false,
    });
  });
});

describe("checkPassword", () => {
  it("returns the local failure without calling the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(checkPassword("short", CONTEXT)).resolves.toBe("TOO_SHORT");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a good password that is not breached", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await expect(checkPassword("granite harbour lantern fold", CONTEXT)).resolves.toBeNull();
  });
});
