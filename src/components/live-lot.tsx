"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/*
 * Keeps an open lot's page current while someone is looking at it.
 *
 * Renders nothing. It watches /api/lots/[id]/pulse — price, bid count,
 * status, closing time — and when any of them move it calls
 * router.refresh(), which refetches the page's server components.
 *
 * That indirection is the point. Patching numbers into the DOM would
 * mean reimplementing eligibility, money formatting, the bilingual copy
 * and the step calculation on the client, and every one of those is a
 * place for the page to start disagreeing with what placeBid will
 * actually accept. Refetching means one implementation, server-side,
 * with the client deciding only *when* to ask.
 *
 * §4 asks for a managed channel instead of a poll, and this is shaped so
 * that swap replaces the trigger and nothing else: the same payload, the
 * same refresh, minus the interval.
 */

type Pulse = {
  status: string;
  bidCount: number;
  currentMinor: string | null;
  closeAtIso: string | null;
};

/** Brisk enough that an endgame feels live, cheap enough to leave running. */
const INTERVAL_MS = 5000;

export function LiveLot({ lotId, initial }: { lotId: string; initial: Pulse }) {
  const router = useRouter();

  /*
   * A ref, not state. Storing the last pulse in state would re-render
   * this component on every poll, and it renders nothing — the only
   * output that matters is the router.refresh() side effect.
   */
  const last = useRef(serialise(initial));
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    /*
     * Nothing to watch on a lot that cannot change. A preview lot's
     * countdown runs to its opening time and is handled by the clock,
     * and a closed lot is final.
     */
    if (initial.status !== "BIDDING_OPEN" && initial.status !== "EXTENDING") return;

    /*
     * Give up after several consecutive failures rather than hammering a
     * server that is already struggling. The page is still correct — it
     * is server-rendered — it simply stops updating itself, and any
     * navigation brings it back.
     */
    if (failures >= 5) return;

    let cancelled = false;

    async function poll() {
      // A hidden tab learns nothing useful and costs a request every
      // five seconds. Outbid email is what reaches someone who looked away.
      if (document.visibilityState !== "visible") return;

      try {
        const response = await fetch(`/api/lots/${lotId}/pulse`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));

        const pulse = (await response.json()) as Pulse;
        if (cancelled) return;

        setFailures(0);

        const next = serialise(pulse);
        if (next !== last.current) {
          last.current = next;
          router.refresh();
        }
      } catch {
        if (!cancelled) setFailures((n) => n + 1);
      }
    }

    const timer = setInterval(poll, INTERVAL_MS);

    // Coming back to the tab should not cost up to five seconds of
    // staleness on a page whose whole subject is a countdown.
    document.addEventListener("visibilitychange", poll);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [lotId, initial.status, failures, router]);

  return null;
}

function serialise(pulse: Pulse): string {
  return `${pulse.status}|${pulse.bidCount}|${pulse.currentMinor ?? ""}|${pulse.closeAtIso ?? ""}`;
}
