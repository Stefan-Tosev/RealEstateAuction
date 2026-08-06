"use client";

import { useActionState, useId } from "react";
import type { Locale } from "@/lib/i18n/locales";
import { placeBidAction, type BidState } from "@/app/(public)/[locale]/lots/[slug]/bid-actions";

/*
 * The bid form: one button, one amount.
 *
 * There is no field to type in. Exactly one amount is valid — the
 * current price plus the increment — so offering a text box only creates
 * ways to get it wrong, and the way it goes wrong is a bidder typing an
 * extra zero into something legally binding.
 *
 * The amount still travels with the submission rather than being derived
 * server-side. If someone else bids between this page rendering and this
 * button being pressed, the server sees an amount that is no longer the
 * step and refuses it. Deriving it server-side would instead commit the
 * bidder to a higher number than the button they pressed said — which is
 * precisely the harm the button exists to prevent.
 *
 * Copy is passed in rather than looked up: the dictionaries are
 * server-only, and the action returns a code precisely so the message can
 * be rendered in the page's language.
 */
export function BidForm({
  locale,
  slug,
  lotId,
  amountMinor,
  amountFormatted,
  attempt,
  premiumNote,
  labels,
}: {
  locale: Locale;
  slug: string;
  lotId: string;
  amountMinor: string;
  amountFormatted: string;
  /**
   * Changes whenever the state of the lot changes — see the note below on
   * why the key cannot be `useId()` alone.
   */
  attempt: string;
  /** What the buyer pays on top, already worked out. */
  premiumNote: string;
  labels: Record<string, string>;
}) {
  const action = placeBidAction.bind(null, locale, slug, lotId);
  const [state, formAction, pending] = useActionState<BidState, FormData>(action, undefined);

  /*
   * The idempotency key has to be stable for one attempt and different
   * for the next, and getting that wrong fails in opposite directions:
   * too volatile and a double-click places two bids, too stable and a
   * bidder's second bid silently replays their first.
   *
   * useId() alone is the second failure. It is derived from the
   * component's position in the tree, so it survives both re-renders and
   * a remount in the same slot. Combined with `attempt`, which the panel
   * derives from the lot's current state, and the amount, which the
   * action appends: two clicks on one rendered form are one bid, and a
   * bid at a new price is a new one.
   */
  const formId = useId();
  const idempotencyKey = `${formId}:${attempt}`;

  return (
    <form className="bid-form" action={formAction} noValidate>
      {state ? (
        <p
          className="bid-message"
          data-tone={state.ok ? "ok" : "error"}
          role={state.ok ? "status" : "alert"}
        >
          {labels[state.code] ?? labels.errorGeneric}
        </p>
      ) : null}

      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="amount" value={amountMinor} />

      <button className="btn btn-brass bid-button" type="submit" disabled={pending}>
        {pending ? labels.placing : labels.place.replace("{amount}", amountFormatted)}
      </button>
      <span className="field-hint">{labels.stepHint.replace("{amount}", amountFormatted)}</span>

      {/*
        Directly under the button that commits them, and spelled out in
        money rather than as a percentage. A premium disclosed only in
        the terms is a premium nobody read.
      */}
      <p className="bid-premium-note">{premiumNote}</p>
    </form>
  );
}
