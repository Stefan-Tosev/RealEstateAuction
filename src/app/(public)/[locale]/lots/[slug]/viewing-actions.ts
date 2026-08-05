"use server";

import { revalidatePath } from "next/cache";
import { requireBidder } from "@/server/identity/authz";
import { bookSlot, cancelBooking } from "@/server/viewings/bookings";

/*
 * Booking is a bidder action, so it asserts kind === "bidder" — an
 * operator browsing the public site is not a bidder and must not be able
 * to take a place.
 *
 * Failures come back as codes; the copy lives in the dictionaries so the
 * message appears in the page's language.
 */

export type BookingState = { code: string } | undefined;

export async function bookViewingAction(
  locale: string,
  slug: string,
  viewingId: string,
  _prev: BookingState,
): Promise<BookingState> {
  let bidder;
  try {
    bidder = await requireBidder();
  } catch {
    return { code: "signin" };
  }

  const result = await bookSlot(bidder.id, viewingId);

  revalidatePath(`/${locale}/lots/${slug}`);

  if (result.ok) return undefined;

  switch (result.reason) {
    case "full":
      return { code: "errorFull" };
    case "past":
      return { code: "errorPast" };
    case "already-booked":
      return { code: "errorAlready" };
    default:
      return { code: "errorGeneric" };
  }
}

export async function cancelViewingAction(
  locale: string,
  slug: string,
  viewingId: string,
): Promise<void> {
  const bidder = await requireBidder();
  await cancelBooking(bidder.id, viewingId);

  revalidatePath(`/${locale}/lots/${slug}`);
}
