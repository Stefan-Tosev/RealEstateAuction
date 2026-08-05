"use client";

import { useActionState, useId } from "react";
import type { Locale } from "@/lib/i18n/locales";
import { placeBidAction, type BidState } from "@/app/(public)/[locale]/lots/[slug]/bid-actions";

/*
 * The bid form.
 *
 * The idempotency key is minted once, when the form renders, and travels
 * with the submission. A double-click or a retry therefore reuses it and
 * placeBid returns the original bid rather than placing a second — which
 * matters more here than anywhere else in the application.
 *
 * Copy is passed in rather than looked up: the dictionaries are
 * server-only, and the action returns a code precisely so the message
 * can be rendered in the page's language.
 */
export function BidForm({
  locale,
  slug,
  lotId,
  minimumMajor,
  attempt,
  labels,
}: {
  locale: Locale;
  slug: string;
  lotId: string;
  minimumMajor: string;
  /**
   * Changes whenever the state of the lot changes — see the note below on
   * why the key cannot be `useId()` alone.
   */
  attempt: string;
  labels: Record<string, string>;
}) {
  const action = placeBidAction.bind(null, locale, slug, lotId);
  const [state, formAction, pending] = useActionState<BidState, FormData>(action, undefined);

  /*
   * The idempotency key has to be stable for one attempt and different
   * for the next, and getting that wrong fails in opposite directions:
   * too volatile and a double-click places two bids, too stable and a
   * bidder's second, higher bid silently replays their first.
   *
   * useId() alone is the second failure. It is derived from the
   * component's position in the tree, so it survives both re-renders and
   * a remount in the same slot — after a successful bid revalidates the
   * page, the form would still be carrying the key that already has a
   * bid against it.
   *
   * So: useId() to separate this form from any other on the page, plus
   * `attempt`, which the panel derives from the lot's current state.
   * The action appends the amount, which is the part this component
   * cannot see — see bid-actions.ts for why it has to be in there.
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

      <label className="field-label" htmlFor="bid-amount">
        {labels.yourBid}
      </label>
      <div className="bid-row">
        <input
          className="field-input"
          id="bid-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          defaultValue={minimumMajor}
          autoComplete="off"
        />
        <button className="btn btn-brass" type="submit" disabled={pending}>
          {pending ? labels.placing : labels.place}
        </button>
      </div>
      <span className="field-hint">{labels.minimumHint}</span>
    </form>
  );
}
