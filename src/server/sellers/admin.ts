import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "@/server/identity/authz";
import { isValidEik } from "@/server/identity/validators";

/*
 * Sellers, as an operator maintains them.
 *
 * §11 keeps lot sourcing admin-curated — there is no self-service seller
 * portal in the MVP and this is not an account anyone logs into. It is a
 * record, so the auction house can telephone somebody when a lot closes
 * below reserve, put a name on the commission it bills, and send the bid
 * log the access design promises after close.
 *
 * Everything here is personal data. It never leaves the admin: the public
 * catalogue's select allowlists omit it structurally, with a test that
 * fails if anyone widens them.
 */

const optionalTrimmed = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v.length === 0 ? null : v));

export const sellerSchema = z
  .object({
    kind: z.enum(["individual", "company"]),
    name: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length > 0, "A name is required."),
    email: optionalTrimmed.refine(
      (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "That does not look like an email address.",
    ),
    phone: optionalTrimmed,
    eik: optionalTrimmed,
    vat: optionalTrimmed,
    address: optionalTrimmed,
    notes: optionalTrimmed,
  })
  .superRefine((value, ctx) => {
    /*
     * A company selling property is invoiced as a company, and an
     * invoice without a valid ЕИК is one the accountant sends back. The
     * same two-pass mod-11 check the bidder registration uses — one
     * implementation, so the two cannot disagree about what is valid.
     */
    if (value.kind === "company") {
      if (!value.eik) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["eik"],
          message: "A company seller needs an ЕИК for the invoice.",
        });
      } else if (!isValidEik(value.eik)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["eik"],
          message: "That ЕИК does not pass its check digit.",
        });
      }
    }
  });

export type SellerInput = z.infer<typeof sellerSchema>;

export function listSellers() {
  return prisma.seller.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      kind: true,
      name: true,
      email: true,
      phone: true,
      _count: { select: { properties: true } },
    },
  });
}

export function getSeller(id: string) {
  return prisma.seller.findUnique({ where: { id } });
}

/** For the property form's selector. Names only — no contact details. */
export function sellerOptions() {
  return prisma.seller.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function createSeller(actor: AdminActor, input: SellerInput) {
  const seller = await prisma.seller.create({ data: input });

  await recordAudit({
    actorId: actor.id,
    action: "seller.create",
    entityType: "seller",
    entityId: seller.id,
    /*
     * The name and the kind, deliberately — not the telephone number or
     * the address. An audit log answers "who did what"; copying contact
     * details into an append-only table makes a second, harder-to-erase
     * store of somebody's personal data for no investigative gain.
     */
    after: { name: seller.name, kind: seller.kind },
  });

  return seller;
}

export async function updateSeller(actor: AdminActor, id: string, input: SellerInput) {
  const before = await prisma.seller.findUniqueOrThrow({
    where: { id },
    select: { name: true, kind: true },
  });

  const seller = await prisma.seller.update({ where: { id }, data: input });

  await recordAudit({
    actorId: actor.id,
    action: "seller.update",
    entityType: "seller",
    entityId: id,
    before,
    after: { name: seller.name, kind: seller.kind },
  });

  return seller;
}
