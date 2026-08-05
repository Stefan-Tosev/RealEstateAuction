"use client";

import { useActionState } from "react";
import type { Locale } from "@/lib/i18n/locales";
import {
  bookViewingAction,
  cancelViewingAction,
  type BookingState,
} from "@/app/(public)/[locale]/lots/[slug]/viewing-actions";

/*
 * Book and cancel. The only client-side part of the viewings section —
 * everything else is server-rendered, so slot data never crosses the
 * boundary as anything but formatted strings.
 *
 * Error copy is passed in rather than looked up here: the dictionaries
 * are server-only, and the action returns a code precisely so the
 * message can be rendered in the page's language.
 */
export function ViewingSlotActions({
  locale,
  slug,
  viewingId,
  booked,
  full,
  labels,
}: {
  locale: Locale;
  slug: string;
  viewingId: string;
  booked: boolean;
  full: boolean;
  labels: Record<string, string>;
}) {
  const book = bookViewingAction.bind(null, locale, slug, viewingId);
  const [state, formAction, pending] = useActionState<BookingState, FormData>(
    async (prev) => book(prev),
    undefined,
  );

  const cancel = cancelViewingAction.bind(null, locale, slug, viewingId);

  if (booked) {
    return (
      <form action={cancel} className="slot-action">
        <button className="btn btn-outline btn-sm" type="submit">
          {labels.cancel}
        </button>
      </form>
    );
  }

  return (
    <form action={formAction} className="slot-action">
      <button className="btn btn-brass btn-sm" type="submit" disabled={pending || full}>
        {pending ? labels.booking : labels.book}
      </button>
      {state?.code ? (
        <span className="slot-error" role="alert">
          {labels[state.code] ?? labels.errorGeneric}
        </span>
      ) : null}
    </form>
  );
}
