import type { Locale as DbLocale } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { localeAlternates } from "@/lib/i18n/alternates";
import { isLocale, LOCALES, otherLocale, type Locale } from "@/lib/i18n/locales";
import { negotiateLocale } from "@/lib/i18n/negotiate";
import { placeName } from "@/lib/i18n/places";
import { interpolate, plural } from "@/lib/i18n/plural";

describe("locales", () => {
  it("accepts the locales we serve and rejects others", () => {
    expect(isLocale("bg")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("stays assignable to Prisma's Locale enum", () => {
    /*
     * Two `Locale` types exist: ours and Prisma's (User.locale, for
     * notification language). They are structurally identical today; if
     * one gains a locale the other lacks, this stops compiling.
     */
    const ours: Locale = "bg";
    const theirs: DbLocale = ours;
    const back: Locale = theirs;
    expect(back).toBe("bg");
  });

  it("pairs each locale with the other", () => {
    expect(otherLocale("bg")).toBe("en");
    expect(otherLocale("en")).toBe("bg");
  });
});

describe("dictionaries", () => {
  // The `Dictionary` type catches most drift at build time, but optional
  // and nested shapes can slip through; this walks the real objects.
  function paths(value: unknown, prefix = ""): string[] {
    if (typeof value === "string") return [prefix];
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      paths(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it("has identical keys in every locale", () => {
    const [first, ...rest] = LOCALES.map((l) => paths(getDictionary(l)).sort());
    for (const other of rest) expect(other).toEqual(first);
  });

  it("has no empty strings", () => {
    for (const locale of LOCALES) {
      const dict = getDictionary(locale);
      const empties = paths(dict).filter((p) => {
        const value = p.split(".").reduce<unknown>((acc, k) => (acc as never)[k], dict);
        return typeof value === "string" && value.trim() === "";
      });
      expect(empties).toEqual([]);
    }
  });

  it("actually differs between locales", () => {
    // Guards against en.ts being copy-pasted from bg.ts and left.
    expect(getDictionary("bg").lot.closesIn).not.toBe(getDictionary("en").lot.closesIn);
  });
});

describe("plural", () => {
  const bgRooms = getDictionary("bg").lot.rooms;
  const enRooms = getDictionary("en").lot.rooms;

  it("uses the singular for exactly one", () => {
    expect(plural("bg", bgRooms, 1)).toBe("1 стая");
    expect(plural("en", enRooms, 1)).toBe("1 room");
  });

  it("uses the plural for everything else", () => {
    expect(plural("bg", bgRooms, 2)).toBe("2 стаи");
    expect(plural("bg", bgRooms, 5)).toBe("5 стаи");
    expect(plural("en", enRooms, 0)).toBe("0 rooms");
  });

  it("formats the number for the locale", () => {
    // 1400 sqm — thousands separators differ between bg and en.
    const bg = interpolate("{n}", "bg", 1400);
    const en = interpolate("{n}", "en", 1400);
    expect(en).toBe("1,400");
    expect(bg).not.toBe(en);
  });
});

describe("negotiateLocale", () => {
  it("prefers an explicit cookie", () => {
    expect(negotiateLocale("en", "bg-BG,bg;q=0.9")).toBe("en");
    expect(negotiateLocale("bg", "en-US,en;q=0.9")).toBe("bg");
  });

  it("ignores a cookie holding a locale we do not serve", () => {
    expect(negotiateLocale("fr", "en-US")).toBe("en");
  });

  it("matches on the primary subtag", () => {
    expect(negotiateLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
    expect(negotiateLocale(undefined, "bg-BG")).toBe("bg");
  });

  it("respects quality weighting", () => {
    // English is preferred despite Bulgarian appearing first.
    expect(negotiateLocale(undefined, "bg;q=0.2,en;q=0.9")).toBe("en");
  });

  it("falls back to Bulgarian", () => {
    expect(negotiateLocale(undefined, "de-DE,fr;q=0.8")).toBe("bg");
    expect(negotiateLocale(undefined, null)).toBe("bg");
    expect(negotiateLocale(undefined, "")).toBe("bg");
  });

  it("survives a malformed header", () => {
    // Never throw on a header we do not control.
    expect(negotiateLocale(undefined, ";;;q=")).toBe("bg");
    expect(negotiateLocale(undefined, "en;q=notanumber")).toBe("bg");
  });
});

describe("localeAlternates", () => {
  it("declares canonical and both languages plus x-default", () => {
    const alternates = localeAlternates("bg", "/lots/foo");

    expect(alternates.canonical).toBe("/bg/lots/foo");
    expect(alternates.languages.bg).toBe("/bg/lots/foo");
    expect(alternates.languages.en).toBe("/en/lots/foo");
    // An unmatched crawler should land on Bulgarian — the listings are
    // physically in Bulgaria.
    expect(alternates.languages["x-default"]).toBe("/bg/lots/foo");
  });

  it("moves the canonical with the page's own locale", () => {
    expect(localeAlternates("en", "/lots").canonical).toBe("/en/lots");
  });
});

describe("placeName", () => {
  it("translates known places", () => {
    expect(placeName("Пловдив", "en")).toBe("Plovdiv");
    expect(placeName("Пловдив", "bg")).toBe("Пловдив");
  });

  it("falls back to the stored value for unknown places", () => {
    // Degrades to Bulgarian rather than rendering nothing.
    expect(placeName("Кюстендил", "en")).toBe("Кюстендил");
  });
});
