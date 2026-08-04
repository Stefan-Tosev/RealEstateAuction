import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ImageRejected,
  MAX_UPLOAD_BYTES,
  processUpload,
  sniffFormat,
} from "@/server/storage/images";

/*
 * Upload handling is the highest-risk surface in the admin: it takes
 * bytes from outside and puts them in the web root. These tests pin the
 * two properties that matter — what gets refused, and what gets stripped.
 */

let jpegWithExif: Buffer;
let png: Buffer;

beforeAll(async () => {
  // A large landscape JPEG carrying GPS metadata, as a phone produces.
  /*
   * sharp's typed withExif() only exposes the IFD blocks, so the fixture
   * carries IFD0 tags rather than a GPS block. That is enough: the
   * property under test is that *all* EXIF is dropped, and GPS is
   * carried in the same metadata segment as everything here.
   */
  jpegWithExif = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: "#345678" },
  })
    .withExif({ IFD0: { Copyright: "Seller", Software: "Camera" } })
    .jpeg()
    .toBuffer();

  png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#111111" } })
    .png()
    .toBuffer();
});

describe("sniffFormat", () => {
  it("identifies the formats we accept", async () => {
    expect(sniffFormat(jpegWithExif)).toBe("jpeg");
    expect(sniffFormat(png)).toBe("png");

    const webp = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#222222" },
    })
      .webp()
      .toBuffer();
    expect(sniffFormat(webp)).toBe("webp");
  });

  it("does not mistake other RIFF containers for WebP", () => {
    // "RIFF" alone is also AVI and WAV; only bytes 8..11 settle it.
    const wav = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WAVE"),
      Buffer.alloc(16),
    ]);
    expect(sniffFormat(wav)).toBeNull();
  });

  it("returns null for things that are not images", () => {
    expect(sniffFormat(Buffer.from("hello world"))).toBeNull();
    expect(sniffFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe("processUpload rejects", () => {
  it("plain text with an image name", async () => {
    // The filename and the browser-supplied MIME type are both attacker
    // controlled; only the bytes decide.
    await expect(processUpload(Buffer.from("not an image at all"))).rejects.toThrow(ImageRejected);
  });

  it("SVG, which is a script container rather than an image", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    // Serving this from our own origin would be stored XSS.
    await expect(processUpload(svg)).rejects.toThrow(ImageRejected);
  });

  it("HTML renamed to .jpg", async () => {
    const html = Buffer.from("<!doctype html><script>alert(document.cookie)</script>");
    await expect(processUpload(html)).rejects.toThrow(ImageRejected);
  });

  it("an empty file", async () => {
    await expect(processUpload(Buffer.alloc(0))).rejects.toThrow(ImageRejected);
  });

  it("anything over the size cap", async () => {
    // Valid JPEG magic bytes, but too large — the size check must not be
    // reachable only after a full decode.
    const oversized = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(MAX_UPLOAD_BYTES + 1),
    ]);
    await expect(processUpload(oversized)).rejects.toThrow(/under \d+ MB/);
  });

  it("a file whose magic bytes lie about the contents", async () => {
    // JPEG signature glued to garbage: passes the sniff, fails the decode.
    const liar = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("garbage".repeat(50))]);
    await expect(processUpload(liar)).rejects.toThrow(ImageRejected);
  });
});

describe("processUpload accepts and normalises", () => {
  it("strips all EXIF metadata", async () => {
    /*
     * The reason this matters: a camera JPEG of a property routinely
     * carries the coordinates it was taken at — frequently the seller's
     * home. Publishing that at full resolution is a privacy breach
     * handed out for free.
     */
    expect((await sharp(jpegWithExif).metadata()).exif).toBeDefined();

    const output = await processUpload(jpegWithExif);

    expect((await sharp(output.buffer).metadata()).exif).toBeUndefined();
  });

  it("caps the long edge and preserves the aspect ratio", async () => {
    const output = await processUpload(jpegWithExif);

    expect(output.width).toBe(2560);
    expect(output.height).toBe(1920); // 4000x3000 is 4:3
  });

  it("does not enlarge a small image", async () => {
    const output = await processUpload(png);
    expect(output.width).toBe(20);
    expect(output.height).toBe(20);
  });

  it("normalises everything to JPEG", async () => {
    // One output format means one set of browser behaviours to reason
    // about, and no chance of an exotic container reaching a visitor.
    const output = await processUpload(png);

    expect(output.extension).toBe("jpg");
    expect(sniffFormat(output.buffer)).toBe("jpeg");
  });

  it("reports dimensions matching the bytes it returns", async () => {
    // PropertyImage.width/height are NOT NULL precisely so next/image can
    // reserve layout space; a mismatch here is a layout-shift bug.
    const output = await processUpload(jpegWithExif);
    const actual = await sharp(output.buffer).metadata();

    expect(actual.width).toBe(output.width);
    expect(actual.height).toBe(output.height);
  });
});
