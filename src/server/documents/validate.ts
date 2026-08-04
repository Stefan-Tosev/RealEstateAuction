/*
 * What may be uploaded as a legal-pack document.
 *
 * §5: "Verify magic bytes, not extensions." A file called deed.pdf is a
 * claim, not a fact, and the browser-supplied content type is no better.
 */

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type DocumentFormat = { mime: string; extension: string };

const SIGNATURES: { format: DocumentFormat; bytes: number[] }[] = [
  // "%PDF-"
  { format: { mime: "application/pdf", extension: "pdf" }, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { format: { mime: "image/jpeg", extension: "jpg" }, bytes: [0xff, 0xd8, 0xff] },
  {
    format: { mime: "image/png", extension: "png" },
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

export class DocumentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRejected";
  }
}

export function sniffDocument(buffer: Buffer): DocumentFormat | null {
  for (const { format, bytes } of SIGNATURES) {
    if (buffer.length < bytes.length) continue;
    if (bytes.every((byte, i) => buffer[i] === byte)) return format;
  }
  return null;
}

/**
 * Validate an upload and report the format the bytes actually are.
 *
 * PDFs are stored as uploaded rather than re-encoded — unlike photographs,
 * a legal document must stay bit-identical to what the notary produced,
 * and its sha256 is recorded so that can be proven. The safety comes from
 * how it is *served* (attachment disposition, nosniff, never inline from
 * our own origin), not from rewriting it.
 */
export function validateDocument(buffer: Buffer, filename: string): DocumentFormat {
  if (buffer.byteLength === 0) throw new DocumentRejected("The file is empty.");
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentRejected(
      `Documents must be under ${Math.floor(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.`,
    );
  }

  const format = sniffDocument(buffer);
  if (!format) throw new DocumentRejected("That file is not a PDF, JPEG or PNG.");

  // The extension is not trusted for validation, but a mismatch is worth
  // refusing: it is either a mistake or an attempt, and neither should
  // end up in a legal pack.
  const claimed = filename.split(".").pop()?.toLowerCase() ?? "";
  const consistent =
    claimed === format.extension || (format.extension === "jpg" && claimed === "jpeg");
  if (!consistent) {
    throw new DocumentRejected(
      `That file is a ${format.extension.toUpperCase()} but is named .${claimed || "?"}.`,
    );
  }

  return format;
}

/**
 * Strip anything from a filename that could confuse a download. The name
 * reaches the browser in a Content-Disposition header, so a quote or a
 * newline in it is a header-injection attempt.
 */
export function safeFilename(filename: string): string {
  return (
    filename
      .replace(new RegExp("[\u0000-\u001F\u007F]", "g"), "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "document"
  );
}
