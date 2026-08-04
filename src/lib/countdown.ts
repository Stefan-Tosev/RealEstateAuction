/*
 * Countdown formatting, kept pure and separate from the component that
 * ticks. The v1 implementation (js/main.js) welded the same logic to a
 * setInterval closure, which made it untestable — the 48-hour urgency
 * boundary in particular was never covered.
 */

/** Inside this window a *bidding* lot is urgent. Two days, per v1. */
export const URGENT_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/** What the server renders, and what the client shows until it knows the offset. */
export const COUNTDOWN_PLACEHOLDER = "--:--:--:--";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `02d 14:03:09`, or `null` once the target has passed.
 *
 * Returning `null` rather than "00d 00:00:00" makes the caller decide
 * what "finished" looks like, which differs between a lot that closed
 * and one whose bidding just opened.
 */
export function formatRemaining(ms: number): string | null {
  if (ms <= 0) return null;

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad(days)}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function isUrgent(remainingMs: number): boolean {
  return remainingMs > 0 && remainingMs <= URGENT_THRESHOLD_MS;
}
