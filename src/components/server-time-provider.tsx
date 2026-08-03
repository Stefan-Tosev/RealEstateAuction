"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/*
 * Holds the offset between the visitor's clock and the server's, and a
 * once-per-second tick. Mounted once per page: a dozen lot cards must
 * not mean a dozen fetches and a dozen intervals drifting against each
 * other.
 *
 * The device clock is still used — but only to measure *elapsed* time
 * since the offset was taken, never as the absolute reference. That is
 * what architecture §3 invariant 5 asks for.
 */

type ServerTime = {
  /** null until the first /api/time response lands. */
  offsetMs: number | null;
  tick: number;
};

const ServerTimeContext = createContext<ServerTime>({ offsetMs: null, tick: 0 });

export function useServerTime(): ServerTime {
  return useContext(ServerTimeContext);
}

export function ServerTimeProvider({ children }: { children: ReactNode }) {
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function sync(attempt = 0): Promise<void> {
      try {
        const sentAt = Date.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        const receivedAt = Date.now();
        if (!res.ok) throw new Error(`time endpoint returned ${res.status}`);

        const { now } = (await res.json()) as { now: string };
        const serverMs = Date.parse(now);
        if (Number.isNaN(serverMs)) throw new Error("unparseable server time");

        /*
         * Charge half the round trip to each direction — the same
         * correction NTP makes. Without it the offset is skewed by the
         * whole request duration, which on a slow mobile connection is
         * seconds, not milliseconds.
         */
        if (!cancelled) setOffsetMs(serverMs - (sentAt + receivedAt) / 2);
      } catch {
        if (attempt === 0) return sync(1);
        /*
         * Fall back to the device clock. In Phase 1 nothing depends on
         * the countdown's accuracy, and a permanently frozen
         * "--:--:--:--" reads as a broken site. Revisit in Phase 3: once
         * this sits next to a bid button, the honest failure mode is to
         * disable bidding, not to guess the time.
         */
        if (!cancelled) setOffsetMs(0);
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <ServerTimeContext.Provider value={{ offsetMs, tick }}>
      {children}
    </ServerTimeContext.Provider>
  );
}
