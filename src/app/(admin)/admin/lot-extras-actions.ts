"use server";

import { revalidatePath } from "next/cache";
import type { DocumentKind, DocumentVisibility, ViewingKind } from "@prisma/client";
import {
  addLotDocument,
  changeDocumentVisibility,
  removeLotDocument,
} from "@/server/documents/admin";
import { DocumentRejected } from "@/server/documents/validate";
import { AuthorizationError, requireAdmin } from "@/server/identity/authz";
import { createSlot, deleteSlot } from "@/server/viewings/bookings";
import type { FormState } from "./catalogue-actions";

/*
 * Legal-pack documents and viewing slots, both hung off a lot.
 *
 * Same discipline as the catalogue actions: every one re-checks
 * permission, and failures come back as values rather than thrown, so
 * the operator sees a reason instead of a server-error digest.
 */

const DOCUMENT_KINDS: DocumentKind[] = [
  "title_deed",
  "sketch",
  "tax_valuation",
  "encumbrances",
  "floor_plan",
  "energy_cert",
  "other",
];

const VISIBILITIES: DocumentVisibility[] = ["public", "registered", "approved_bidders"];

function toFormState(error: unknown): FormState {
  if (error instanceof AuthorizationError) return { message: error.message };
  if (error instanceof DocumentRejected) return { message: error.message };
  throw error;
}

// ---------- Documents ----------

export async function uploadDocumentAction(
  lotId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { errors: { file: "Choose a document to upload." } };
    }

    const kind = String(formData.get("kind") ?? "") as DocumentKind;
    const visibility = String(formData.get("visibility") ?? "") as DocumentVisibility;

    if (!DOCUMENT_KINDS.includes(kind)) return { errors: { kind: "Choose a document type." } };
    if (!VISIBILITIES.includes(visibility)) {
      return { errors: { visibility: "Choose who may download this." } };
    }

    await addLotDocument(actor, lotId, {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      kind,
      visibility,
    });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/admin/lots/${lotId}`);
  // The public page lists the pack, so it has to reflect the new document.
  revalidatePath("/bg/lots", "layout");
  return { message: "Document uploaded." };
}

export async function deleteDocumentAction(lotId: string, formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  await removeLotDocument(actor, String(formData.get("documentId")));

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/bg/lots", "layout");
}

export async function setDocumentVisibilityAction(
  lotId: string,
  formData: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const visibility = String(formData.get("visibility")) as DocumentVisibility;
  if (!VISIBILITIES.includes(visibility)) return;

  await changeDocumentVisibility(actor, String(formData.get("documentId")), visibility);

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/bg/lots", "layout");
}

// ---------- Viewing slots ----------

export async function createSlotAction(
  lotId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();

    const startsAtRaw = String(formData.get("startsAt") ?? "");
    const startsAt = new Date(startsAtRaw);
    if (!startsAtRaw || Number.isNaN(startsAt.getTime())) {
      return { errors: { startsAt: "Enter when the viewing starts." } };
    }
    if (startsAt.getTime() <= Date.now()) {
      // Nobody can book a slot in the past, so creating one is a mistake
      // worth catching at the point of entry.
      return { errors: { startsAt: "That is in the past." } };
    }

    const durationMinutes = Number(formData.get("durationMinutes"));
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      return { errors: { durationMinutes: "Between 5 and 480 minutes." } };
    }

    const capacity = Number(formData.get("capacity"));
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
      return { errors: { capacity: "Between 1 and 200 people." } };
    }

    const kind = String(formData.get("kind") ?? "") as ViewingKind;
    if (kind !== "private" && kind !== "open_house") {
      return { errors: { kind: "Choose private or open house." } };
    }

    await createSlot(actor, lotId, { startsAt, durationMinutes, capacity, kind });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/bg/lots", "layout");
  return { message: "Viewing added." };
}

export async function deleteSlotAction(lotId: string, formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  // Anyone booked is notified — see deleteSlot.
  await deleteSlot(actor, String(formData.get("viewingId")));

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/bg/lots", "layout");
}
