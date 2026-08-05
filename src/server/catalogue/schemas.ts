import { z } from "zod";
import { parseMoneyInput } from "@/lib/money";

/*
 * Input validation for the admin forms. First use of zod in the app.
 *
 * These run on the server, inside the server action, on data that
 * arrived as FormData — i.e. on strings that a browser may or may not
 * have sanity-checked. Client-side constraints on the form are a
 * convenience; this is the control.
 *
 * The same principle CLAUDE.md records for the v1 registration form:
 * everything in the browser is a UX affordance, and every rule has to be
 * re-run here before it means anything.
 */

/** Trim, then treat an empty string as absent — FormData never omits a field. */
const optionalText = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v.length === 0 ? null : v));

const requiredText = (label: string, max = 300) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} is too long.`));

/*
 * A slug is a permanent public URL. Restricting it to lowercase ASCII
 * keeps links typeable and avoids percent-encoded Cyrillic in every
 * canonical tag and sitemap entry.
 */
export const slugSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(3, "Slug must be at least 3 characters.")
      .max(120, "Slug is too long.")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens."),
  );

/** Optional integer from a form field, rejecting "12abc" rather than coercing it to 12. */
const optionalInt = (label: string, min: number, max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .superRefine((v, ctx) => {
      if (v.length === 0) return;
      if (!/^-?\d+$/.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a whole number.` });
        return;
      }
      const n = Number(v);
      if (n < min || n > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be between ${min} and ${max}.`,
        });
      }
    })
    .transform((v) => (v.length === 0 ? null : Number(v)));

/*
 * Money arrives from the form in MAJOR units (euros) because that is
 * what an operator types, and is stored in minor units. Parsing here
 * rather than in the component keeps the conversion in one place and
 * out of the UI.
 *
 * Reading the typed amount is parseMoneyInput's job — it is the only
 * thing on the site that does it, because getting the separators wrong
 * is a hundredfold error rather than a rounding one.
 */
export const majorToMinor = (label: string) =>
  z
    .string()
    /*
     * Validation stays in superRefine and conversion in transform.
     * Raising the issue from inside the transform instead lets a bad
     * field through as undefined, and the cross-field reserve rule below
     * then compares undefined against a bigint and throws.
     */
    .superRefine((v, ctx) => {
      if (v.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is required.` });
        return;
      }
      if (parseMoneyInput(v) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be an amount like 100000 or 100000.50.`,
        });
      }
    })
    // Reached only once the refinement passed, so the parse cannot be null.
    .transform((v) => parseMoneyInput(v)!);

const optionalMajorToMinor = (label: string) =>
  z
    .string()
    .superRefine((v, ctx) => {
      if (v.trim().length === 0) return;
      if (parseMoneyInput(v) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be an amount like 2000 or 2000.50.`,
        });
      }
    })
    .transform((v) => (v.trim().length === 0 ? null : parseMoneyInput(v)!));

export const propertySchema = z.object({
  slug: slugSchema,
  /*
   * Both languages required, matching the schema's NOT NULL columns. A
   * half-translated listing is the failure mode the bilingual pattern
   * exists to prevent, and it is much cheaper to refuse here than to
   * discover on the English page.
   */
  titleBg: requiredText("Bulgarian title"),
  titleEn: requiredText("English title"),
  descriptionBg: requiredText("Bulgarian description", 5000),
  descriptionEn: requiredText("English description", 5000),
  address: requiredText("Address"),
  city: requiredText("City", 120),
  region: requiredText("Region", 120),
  propertyType: z.enum(["apartment", "house", "land", "commercial", "other"]),
  rooms: optionalInt("Rooms", 0, 100),
  areaSqm: optionalInt("Area", 1, 1_000_000),
  floor: optionalInt("Floor", -5, 200),
  yearBuilt: optionalInt("Year built", 1000, 2100),
  cadastralId: optionalText,
});

export type PropertyInput = z.infer<typeof propertySchema>;

export const lotSchema = z
  .object({
    propertyId: z.string().uuid("Choose a property."),
    lotNumber: z
      .string()
      .transform((v) => v.trim())
      .pipe(z.string().regex(/^\d+$/, "Lot number must be a whole number."))
      .transform(Number)
      .pipe(z.number().int().min(1).max(999_999)),
    startingPriceMinor: majorToMinor("Guide price"),
    reservePriceMinor: majorToMinor("Reserve price"),
    bidIncrementMinor: optionalMajorToMinor("Bid increment"),
    depositRequiredMinor: optionalMajorToMinor("Deposit"),
    previewStartsAt: optionalText,
    biddingOpensAt: optionalText,
    scheduledCloseAt: optionalText,
  })
  .superRefine((value, ctx) => {
    /*
     * §10 convention: "reserve ≤ ~110% of the published guide price".
     * A convention, not a law — the auctioneer may have a reason — so
     * this refuses the clearly indefensible rather than the merely
     * unusual. A reserve *below* the guide is nonsense in every case,
     * because the guide is what bidders are told to expect.
     */
    if (value.reservePriceMinor < value.startingPriceMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reservePriceMinor"],
        message: "Reserve cannot be below the guide price.",
      });
    }

    if (value.reservePriceMinor > (value.startingPriceMinor * 150n) / 100n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reservePriceMinor"],
        message:
          "Reserve is more than 150% of the guide price. Convention is ~110% — a reserve this far above guide is how lots go unsold.",
      });
    }

    const preview = value.previewStartsAt ? Date.parse(value.previewStartsAt) : null;
    const opens = value.biddingOpensAt ? Date.parse(value.biddingOpensAt) : null;
    const closes = value.scheduledCloseAt ? Date.parse(value.scheduledCloseAt) : null;

    for (const [field, parsed] of [
      ["previewStartsAt", preview],
      ["biddingOpensAt", opens],
      ["scheduledCloseAt", closes],
    ] as const) {
      if (parsed !== null && Number.isNaN(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Not a valid date." });
      }
    }

    if (preview && opens && !Number.isNaN(preview) && !Number.isNaN(opens) && opens <= preview) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["biddingOpensAt"],
        message: "Bidding must open after the preview starts.",
      });
    }

    if (opens && closes && !Number.isNaN(opens) && !Number.isNaN(closes) && closes <= opens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledCloseAt"],
        message: "The close must be after bidding opens.",
      });
    }
  });

export type LotInput = z.infer<typeof lotSchema>;

export const imageMetaSchema = z.object({
  altBg: requiredText("Bulgarian alt text"),
  altEn: requiredText("English alt text"),
});

/** Flatten zod issues into the `{ field: message }` shape the forms render. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    // First message per field: showing three at once on one input is noise.
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}
