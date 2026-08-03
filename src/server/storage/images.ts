import sharp from "sharp";

/*
 * Turning an uploaded file into something safe to serve.
 *
 * Two things matter here and neither is optional for property
 * photography:
 *
 * 1. Trust the bytes, not the name. `photo.jpg` says nothing — the
 *    extension and the browser-supplied MIME type are both attacker
 *    controlled. The magic-byte check below is what decides.
 *
 * 2. Re-encode, never pass through. A camera JPEG routinely carries EXIF
 *    GPS coordinates. Publishing a seller's photo with the coordinates
 *    of the property — often their home — intact is a privacy breach
 *    handed out at full resolution. Re-encoding through sharp drops all
 *    metadata by default, and also neutralises polyglot files that are
 *    valid image *and* valid something-else.
 */

/** Accepted input formats, by magic bytes. */
const SIGNATURES: { format: string; bytes: number[]; offset?: number }[] = [
  { format: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { format: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WEBP is "RIFF....WEBP" — check both halves, since RIFF alone is also AVI and WAV.
  { format: "webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Long edge cap. Larger than any layout needs, small enough to serve. */
const MAX_DIMENSION = 2560;

export class ImageRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejected";
  }
}

export function sniffFormat(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    if (sig.bytes.every((byte, i) => buffer[offset + i] === byte)) {
      if (sig.format === "webp") {
        // Bytes 8..11 must be "WEBP" for a RIFF container to be an image.
        if (buffer.length < 12) continue;
        if (buffer.toString("ascii", 8, 12) !== "WEBP") continue;
      }
      return sig.format;
    }
  }
  return null;
}

export type ProcessedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  /** Always jpg — everything is normalised on the way in. */
  extension: "jpg";
};

/**
 * Validate and normalise an upload.
 *
 * Output is always JPEG: one format to serve, one set of behaviours to
 * reason about, and no chance of an SVG (which is a script container,
 * not an image) reaching the browser from our own origin.
 */
export async function processUpload(buffer: Buffer): Promise<ProcessedImage> {
  if (buffer.length === 0) throw new ImageRejected("The file is empty.");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ImageRejected(
      `Images must be under ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    );
  }

  const format = sniffFormat(buffer);
  if (!format) {
    throw new ImageRejected("That file is not a JPEG, PNG or WebP image.");
  }

  // A decompression bomb is a small file that expands to gigabytes in
  // memory; sharp refuses above this pixel count rather than trying.
  const openOptions: sharp.SharpOptions = { limitInputPixels: 100_000_000 };

  const metadata = await sharp(buffer, openOptions)
    .metadata()
    .catch(() => null);
  if (!metadata?.width || !metadata.height) {
    throw new ImageRejected("That image could not be read.");
  }

  const output = await sharp(buffer, openOptions)
    // Honour the EXIF orientation flag *before* stripping metadata,
    // otherwise portrait photos from a phone come out on their side.
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, progressive: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height,
    extension: "jpg",
  };
}
