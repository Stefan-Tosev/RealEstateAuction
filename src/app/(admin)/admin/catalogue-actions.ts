"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LotStatus } from "@prisma/client";
import {
  addPropertyImage,
  agreeReserve,
  changeLotStatus,
  createLot,
  createProperty,
  deletePropertyImage,
  reorderPropertyImages,
  TransitionRefused,
  updateLot,
  updateProperty,
} from "@/server/catalogue/admin";
import { fieldErrors, imageMetaSchema, lotSchema, propertySchema } from "@/server/catalogue/schemas";
import { AuthorizationError, requireAdmin, requireRoleFor } from "@/server/identity/authz";
import { ImageRejected, processUpload } from "@/server/storage/images";
import { mediaStorage } from "@/server/storage";
import { prisma } from "@/lib/prisma";

/*
 * Server actions for the admin catalogue.
 *
 * Every one of these re-checks permission. The UI hides buttons a `staff`
 * account may not use, but a hidden button is a hint, not a control —
 * these endpoints are reachable by anyone who can construct a POST.
 *
 * Errors are returned as values rather than thrown, matching the pattern
 * loginAction established: a thrown error in a server action becomes a
 * generic digest in production and tells the operator nothing.
 */

export type FormState = {
  errors?: Record<string, string>;
  message?: string;
  /**
   * What the operator submitted, echoed back so the form can re-fill
   * itself.
   *
   * React 19 resets an uncontrolled form once its action completes. On a
   * validation failure that means everything typed is gone — which on a
   * form the length of a property listing is a genuinely bad afternoon.
   * A form that reads these back survives its own error messages.
   */
  values?: Record<string, string>;
} | undefined;

/** Turn thrown authorization/validation failures into renderable state. */
function toFormState(error: unknown): FormState {
  if (error instanceof AuthorizationError) return { message: error.message };
  if (error instanceof TransitionRefused) return { message: error.reasons.join(" ") };
  if (error instanceof ImageRejected) return { message: error.message };
  throw error;
}

// ---------- Properties ----------

export async function savePropertyAction(
  propertyId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let slug: string;
  try {
    const actor = await requireAdmin();

    const parsed = propertySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: fieldErrors(parsed.error) };

    // The slug is a public URL; a collision is a validation failure, not
    // a 500, so it is checked rather than caught from the unique index.
    const clash = await prisma.property.findFirst({
      where: { slug: parsed.data.slug, ...(propertyId ? { NOT: { id: propertyId } } : {}) },
      select: { id: true },
    });
    if (clash) return { errors: { slug: "That slug is already in use." } };

    const property = propertyId
      ? await updateProperty(actor, propertyId, parsed.data)
      : await createProperty(actor, parsed.data);

    slug = property.slug;
  } catch (error) {
    return toFormState(error);
  }

  // redirect() throws, so it must sit outside the try.
  revalidatePath("/admin/properties");
  revalidatePath(`/bg/lots/${slug}`);
  redirect("/admin/properties");
}

// ---------- Images ----------

export async function uploadImageAction(
  propertyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();

    const meta = imageMetaSchema.safeParse(Object.fromEntries(formData));
    if (!meta.success) return { errors: fieldErrors(meta.error) };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { errors: { file: "Choose an image to upload." } };
    }

    const property = await prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { slug: true },
    });

    // Validates magic bytes, strips metadata, caps dimensions.
    const processed = await processUpload(Buffer.from(await file.arrayBuffer()));

    // Random suffix so a re-upload never collides with a cached URL of
    // a previous image at the same position.
    const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${processed.extension}`;
    const storageKey = `properties/${property.slug}/${name}`;

    await mediaStorage.put(storageKey, processed.buffer);

    await addPropertyImage(actor, propertyId, {
      storageKey,
      width: processed.width,
      height: processed.height,
      altBg: meta.data.altBg,
      altEn: meta.data.altEn,
    });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/admin/properties/${propertyId}`);
  return { message: "Image uploaded." };
}

export async function deleteImageAction(propertyId: string, formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  const imageId = String(formData.get("imageId"));

  await deletePropertyImage(actor, imageId);
  revalidatePath(`/admin/properties/${propertyId}`);
}

export async function moveImageAction(propertyId: string, formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  const imageId = String(formData.get("imageId"));
  const direction = formData.get("direction") === "up" ? -1 : 1;

  const images = await prisma.propertyImage.findMany({
    where: { propertyId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  const from = images.findIndex((i) => i.id === imageId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= images.length) return;

  const ordered = images.map((i) => i.id);
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];

  await reorderPropertyImages(actor, propertyId, ordered);
  revalidatePath(`/admin/properties/${propertyId}`);
}

// ---------- Lots ----------

export async function saveLotAction(
  lotId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();

    const parsed = lotSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: fieldErrors(parsed.error) };

    if (lotId) {
      /*
       * Editing a lot that is already live is a different act from
       * drafting one — bidders may be looking at these numbers right now.
       */
      const existing = await prisma.lot.findUniqueOrThrow({
        where: { id: lotId },
        select: { status: true },
      });
      if (existing.status !== "DRAFT") await requireRoleFor("lot.editLive");

      await updateLot(actor, lotId, parsed.data);
    } else {
      const clash = await prisma.lot.findFirst({
        where: { propertyId: parsed.data.propertyId, lotNumber: parsed.data.lotNumber },
        select: { id: true },
      });
      if (clash) {
        return { errors: { lotNumber: "That property already has a lot with this number." } };
      }

      await createLot(actor, parsed.data);
    }
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath("/admin/lots");
  redirect("/admin/lots");
}

export async function agreeReserveAction(lotId: string): Promise<FormState> {
  try {
    // §10: this is the auctioneer's act, not general data entry.
    const actor = await requireRoleFor("lot.agreeReserve");
    await agreeReserve(actor, lotId);
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/admin/lots");
  return { message: "Reserve agreed." };
}

export async function changeStatusAction(
  lotId: string,
  to: LotStatus,
  _prev: FormState,
): Promise<FormState> {
  try {
    const actor = await requireRoleFor(to === "CANCELLED" ? "lot.cancel" : "lot.publish");
    await changeLotStatus(actor, lotId, to);
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/admin/lots");
  revalidatePath("/bg/lots");
  revalidatePath("/en/lots");
  return { message: `Lot moved to ${to}.` };
}
