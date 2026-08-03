"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { COUNTDOWN_PLACEHOLDER, formatRemaining, isUrgent } from "@/lib/countdown";
import { useServerTime } from "./server-time-provider";

/*
 * The ticking digits only. The label beside it ("Closes in" vs "Bidding
 * opens in") is rendered by the server component that owns this one, so
 * the client bundle carries formatting logic and nothing else.
 *
 * Class and attribute names are v1's, so the ported CSS in catalogue.css
 * applies unchanged. v1's `data-countdown-inited` guard is gone — it
 * existed to stop double-registering intervals on re-injected markup,
 * which React ownership makes impossible.
 */

type Props = {
  targetIso: string;
  /**
   * Urgency is a *bidding* concept. A lot forty hours from opening is
   * good news; painting it amber inverts the meaning. Passed down rather
   * than inferred here, because only the page knows the phase.
   */
  urgentWhenClose: boolean;
  expiredLabel: string;
  className?: string;
};

export function Countdown({ targetIso, urgentWhenClose, expiredLabel, className }: Props) {
  const { offsetMs } = useServerTime();
  const router = useRouter();
  const refreshed = useRef(false);

  const remaining =
    offsetMs === null ? null : Date.parse(targetIso) - (Date.now() + offsetMs);
  const text = remaining === null ? null : formatRemaining(remaining);

  /*
   * When the clock runs out the page is stale — a lot that just moved
   * from PUBLISHED to BIDDING_OPEN is still rendering a preview badge.
   * Refresh once to pick up the new status rather than sitting on it.
   */
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [remaining, router]);

  const classes = ["lot-countdown", className].filter(Boolean).join(" ");

  // Before the offset resolves, render exactly what the server rendered:
  // hydration matches, and no device-clock-derived value is ever shown,
  // not even for one frame.
  if (offsetMs === null) {
    return (
      <span className={classes} data-countdown>
        {COUNTDOWN_PLACEHOLDER}
      </span>
    );
  }

  if (text === null) {
    return (
      <span className={classes} data-countdown data-closed="">
        {expiredLabel}
      </span>
    );
  }

  return (
    <span
      className={classes}
      data-countdown
      {...(urgentWhenClose && remaining !== null && isUrgent(remaining)
        ? { "data-urgent": "" }
        : {})}
    >
      {text}
    </span>
  );
}
