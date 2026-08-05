import { describe, expect, it, vi } from "vitest";
import {
  DocumentRejected,
  MAX_DOCUMENT_BYTES,
  safeFilename,
  sniffDocument,
  validateDocument,
} from "@/server/documents/validate";
import {
  LINK_TTL_MS,
  signDocumentUrl,
  verifyDocumentSignature,
} from "@/server/documents/signed-url";

/*
 * Legal packs are the most sensitive thing this application serves —
 * нотариален акт, tax valuations, encumbrance certificates. These tests
 * cover the rules in docs/architecture.md §5 that decide what gets
 * stored and who can construct a link to it.
 */

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

describe("format detection", () => {
  it("identifies the formats a legal pack may contain", () => {
    expect(sniffDocument(PDF)).toMatchObject({ mime: "application/pdf" });
    expect(sniffDocument(JPEG)).toMatchObject({ mime: "image/jpeg" });
  });

  it("refuses anything else, whatever it is named", () => {
    // §5: verify magic bytes, not extensions. A name is a claim.
    expect(sniffDocument(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffDocument(Buffer.from("PK zip"))).toBeNull();
    expect(sniffDocument(Buffer.alloc(0))).toBeNull();
  });
});

describe("validateDocument", () => {
  it("accepts a PDF named as one", () => {
    expect(validateDocument(PDF, "notarialen-akt.pdf")).toMatchObject({
      mime: "application/pdf",
    });
  });

  it("refuses an executable dressed as a PDF", () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]);
    expect(() => validateDocument(exe, "deed.pdf")).toThrow(DocumentRejected);
  });

  it("refuses HTML dressed as a PDF", () => {
    // Served from our own origin this would be stored XSS.
    const html = Buffer.from("<!doctype html><script>alert(document.cookie)</script>");
    expect(() => validateDocument(html, "deed.pdf")).toThrow(DocumentRejected);
  });

  it("refuses a real PDF whose name claims another type", () => {
    // Either a mistake or an attempt; neither belongs in a legal pack.
    expect(() => validateDocument(PDF, "deed.jpg")).toThrow(/is a PDF but is named/i);
  });

  it("accepts .jpeg as well as .jpg", () => {
    expect(validateDocument(JPEG, "photo.jpeg")).toMatchObject({ mime: "image/jpeg" });
  });

  it("bounds the size before doing anything else", () => {
    const huge = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    expect(() => validateDocument(huge, "big.pdf")).toThrow(/under \d+ MB/);
  });

  it("refuses an empty file", () => {
    expect(() => validateDocument(Buffer.alloc(0), "empty.pdf")).toThrow(DocumentRejected);
  });
});

describe("safeFilename", () => {
  it("strips characters that would break a Content-Disposition header", () => {
    // A newline in a filename is a header-injection attempt.
    expect(safeFilename('deed"\r\nX-Injected: yes.pdf')).not.toContain("\r");
    expect(safeFilename('deed"\r\nX-Injected: yes.pdf')).not.toContain('"');
  });

  it("keeps Cyrillic, which is what these files are actually called", () => {
    expect(safeFilename("нотариален-акт.pdf")).toBe("нотариален-акт.pdf");
  });

  it("neutralises path separators", () => {
    expect(safeFilename("../../etc/passwd")).not.toContain("/");
  });

  it("never returns an empty name", () => {
    expect(safeFilename("   ")).toBe("document");
  });
});

describe("signed links", () => {
  const DOC = "11111111-1111-1111-1111-111111111111";

  it("produces a link that verifies", () => {
    const url = signDocumentUrl(DOC, "bidder:abc");
    const params = new URL(url, "http://localhost").searchParams;

    expect(
      verifyDocumentSignature(DOC, "bidder:abc", params.get("exp"), params.get("sig")),
    ).toBe("ok");
  });

  it("is bound to the viewer it was minted for", () => {
    /*
     * The property that stops a signed link being forwarded to someone
     * not entitled to it: another bidder's identity produces a different
     * signature over the same document.
     */
    const url = signDocumentUrl(DOC, "bidder:abc");
    const params = new URL(url, "http://localhost").searchParams;

    expect(
      verifyDocumentSignature(DOC, "bidder:someone-else", params.get("exp"), params.get("sig")),
    ).toBe("bad-signature");
  });

  it("is bound to the document it was minted for", () => {
    const url = signDocumentUrl(DOC, "bidder:abc");
    const params = new URL(url, "http://localhost").searchParams;

    expect(
      verifyDocumentSignature("22222222-2222-2222-2222-222222222222", "bidder:abc", params.get("exp"), params.get("sig")),
    ).toBe("bad-signature");
  });

  it("expires", () => {
    const now = Date.now();
    const url = signDocumentUrl(DOC, "bidder:abc", now);
    const params = new URL(url, "http://localhost").searchParams;

    expect(
      verifyDocumentSignature(DOC, "bidder:abc", params.get("exp"), params.get("sig"), now + 1_000),
    ).toBe("ok");

    expect(
      verifyDocumentSignature(
        DOC,
        "bidder:abc",
        params.get("exp"),
        params.get("sig"),
        now + LINK_TTL_MS + 1_000,
      ),
    ).toBe("expired");
  });

  it("refuses a hand-made link", () => {
    const forged = String(Date.now() + 60_000);
    expect(verifyDocumentSignature(DOC, "anonymous", forged, "made-up")).toBe("bad-signature");
    expect(verifyDocumentSignature(DOC, "anonymous", null, null)).toBe("bad-signature");
  });

  it("checks the signature before the expiry", () => {
    /*
     * So a forged link and a stale one are indistinguishable to whoever
     * sent them — "expired" would otherwise confirm the signature was
     * valid, which is a hint worth not giving.
     */
    expect(verifyDocumentSignature(DOC, "anonymous", "1", "made-up")).toBe("bad-signature");
  });
});
