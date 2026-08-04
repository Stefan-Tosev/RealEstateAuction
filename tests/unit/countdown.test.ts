import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_PLACEHOLDER,
  formatRemaining,
  isUrgent,
  URGENT_THRESHOLD_MS,
} from "@/lib/countdown";

/*
 * v1 welded this logic into a setInterval closure, so none of it was
 * testable — the 48-hour urgency boundary in particular was never
 * covered despite driving a visual state change.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRemaining", () => {
  it("renders days, hours, minutes and seconds", () => {
    expect(formatRemaining(2 * DAY + 14 * HOUR + 3 * MINUTE + 9 * SECOND)).toBe("02d 14:03:09");
  });

  it("pads a sub-day remainder to 00d", () => {
    expect(formatRemaining(5 * HOUR)).toBe("00d 05:00:00");
  });

  it("pads every component to two digits", () => {
    expect(formatRemaining(DAY + HOUR + MINUTE + SECOND)).toBe("01d 01:01:01");
  });

  it("does not roll days over at 100", () => {
    // A 21-day preview plus a long schedule can exceed 99 days; the
    // format should widen rather than wrap.
    expect(formatRemaining(120 * DAY)).toBe("120d 00:00:00");
  });

  it("returns null at zero and below", () => {
    expect(formatRemaining(0)).toBeNull();
    expect(formatRemaining(-1)).toBeNull();
    expect(formatRemaining(-DAY)).toBeNull();
  });

  it("truncates sub-second remainders rather than rounding up", () => {
    expect(formatRemaining(1500)).toBe("00d 00:00:01");
  });

  it("keeps the placeholder the same width as a real value", () => {
    // The server renders the placeholder and the client replaces it; a
    // width change would shift the layout on hydration.
    expect(COUNTDOWN_PLACEHOLDER).toHaveLength("00d 00:00:00".length - 1);
  });
});

describe("isUrgent", () => {
  it("is true inside the 48-hour window", () => {
    expect(isUrgent(47 * HOUR)).toBe(true);
  });

  it("is true exactly at the boundary", () => {
    expect(isUrgent(URGENT_THRESHOLD_MS)).toBe(true);
  });

  it("is false just outside it", () => {
    expect(isUrgent(URGENT_THRESHOLD_MS + 1)).toBe(false);
  });

  it("is false once the target has passed", () => {
    // A closed lot is not urgent — it takes the [data-closed] styling.
    expect(isUrgent(0)).toBe(false);
    expect(isUrgent(-HOUR)).toBe(false);
  });

  it("uses the 48-hour threshold v1 established", () => {
    expect(URGENT_THRESHOLD_MS).toBe(48 * HOUR);
  });
});
