import { describe, expect, it } from "vitest";
import { MARKETS, REQUIRED_MARKET_CODES, marketFor } from "@/server/copy/markets";
import { systemPrompt, userPrompt } from "@/server/copy/prompt";
import { verifyDraft } from "@/server/copy/verify";
import type { PropertyFacts } from "@/server/copy/types";

/*
 * Drafting listing copy.
 *
 * The generation itself needs an API key and a network, so it is not
 * tested here. What is tested is everything that decides whether the
 * output is safe to publish — the prompt's constraints and the check that
 * runs after, both pure.
 *
 * The stakes: misdescription by an agent is the AGENT's liability, which
 * is the one part of the legal position where the auction house is
 * exposed rather than the seller.
 */

const facts: PropertyFacts = {
  propertyType: "apartment",
  city: "София",
  region: "София",
  address: "ул. Оборище 14, Лозенец",
  rooms: 3,
  areaSqm: 96,
  floor: 4,
  yearBuilt: 2011,
  notes: "Ъглов апартамент с две тераси.",
};

describe("the prompt", () => {
  it("forbids inventing anything, in the first rule", () => {
    const system = systemPrompt();
    expect(system).toMatch(/ONLY the facts you are given/);
    expect(system).toMatch(/Do not add, infer or embellish/);
  });

  it("forbids the legal and financial topics that belong to the pack", () => {
    const system = systemPrompt();
    for (const topic of ["title", "encumbrances", "taxes", "planning permission"]) {
      expect(system, topic).toContain(topic);
    }
    // The price is decided by bidding, and copy calling a lot a bargain
    // is the house making a claim about value it cannot support.
    expect(system).toMatch(/bargain|priced below value/);
  });

  it("omits a fact it does not have rather than sending it as unknown", () => {
    /*
     * "Floor: unknown" in a prompt is an invitation to fill it in.
     * Silence is not.
     */
    const thin = { ...facts, floor: null, yearBuilt: null };
    const prompt = userPrompt(thin, MARKETS);

    expect(prompt).not.toMatch(/Floor/);
    expect(prompt).not.toMatch(/Year built/);
    expect(prompt).not.toMatch(/unknown|null|N\/A/i);
    expect(prompt).toContain("Rooms: 3");
  });

  it("asks for every language in one request, so they cannot drift apart", () => {
    /*
     * Separate calls per locale is the obvious implementation and the
     * wrong one: two descriptions that disagree about the number of
     * rooms means one of them is a misdescription.
     */
    const prompt = userPrompt(facts, MARKETS);

    for (const market of MARKETS) expect(prompt).toContain(market.code);
    expect(prompt).toMatch(/every version must state exactly the same facts/i);
    expect(prompt).toMatch(/Do not translate one/i);
  });

  it("carries the operator's notes, which are the only new facts allowed in", () => {
    expect(userPrompt(facts, MARKETS)).toContain("Ъглов апартамент с две тераси.");
  });
});

describe("markets", () => {
  it("covers the locales the site actually serves", () => {
    for (const code of REQUIRED_MARKET_CODES) {
      expect(() => marketFor(code)).not.toThrow();
    }
  });

  it("refuses a market nobody configured rather than guessing at one", () => {
    expect(() => marketFor("ro")).toThrow(/No market configured/);
  });
});

describe("verifying a draft", () => {
  it("passes copy that stays inside the facts", () => {
    const warnings = verifyDraft(
      {
        titles: { bg: "Тристаен апартамент в Лозенец", en: "Three-room apartment in Lozenets" },
        descriptions: {
          bg: "Апартамент от 96 кв.м на етаж 4, построен през 2011 г. Две тераси.",
          en: "A 96 sqm apartment on floor 4, built in 2011. Two terraces.",
        },
      },
      facts,
    );

    expect(warnings).toEqual([]);
  });

  it("flags a claim about title, in either language", () => {
    /*
     * The exact sentence that must never ship. Legal status belongs to
     * the legal pack, where the seller's solicitor produces it and the
     * seller warrants it.
     */
    const warnings = verifyDraft(
      {
        titles: { bg: "Апартамент", en: "Apartment" },
        descriptions: {
          bg: "Имотът е без тежести и е готов за продажба.",
          en: "The property has clear title and no encumbrances.",
        },
      },
      facts,
    );

    expect(warnings.filter((w) => w.kind === "forbidden-topic").length).toBeGreaterThanOrEqual(2);
    expect(warnings.some((w) => w.locale === "bg")).toBe(true);
    expect(warnings.some((w) => w.locale === "en")).toBe(true);
  });

  it("flags a number nobody supplied", () => {
    // The failure this exists to catch: an invented detail that reads
    // perfectly well and is a misdescription.
    const warnings = verifyDraft(
      {
        titles: { en: "Apartment" },
        descriptions: { en: "A 96 sqm apartment with 2 parking spaces and 18 metres of frontage." },
      },
      facts,
    );

    expect(warnings.some((w) => w.kind === "unsupported-number" && w.detail.includes("18"))).toBe(
      true,
    );
  });

  it("does not flag numbers the operator's own notes introduced", () => {
    const withNotes = { ...facts, notes: "Двор от 620 кв.м и гараж за 2 автомобила." };

    const warnings = verifyDraft(
      { titles: { bg: "Къща" }, descriptions: { bg: "Двор от 620 кв.м." } },
      withNotes,
    );

    expect(warnings).toEqual([]);
  });

  it("matches Cyrillic terms on word boundaries, not as substrings", () => {
    /*
     * \b is defined on ASCII word characters and does not fire correctly
     * around Cyrillic, so the boundary check is written by hand — and a
     * term appearing inside a longer word must not trip it.
     */
    const warnings = verifyDraft(
      { titles: { bg: "Дом" }, descriptions: { bg: "Просторен дом с южно изложение." } },
      facts,
    );

    expect(warnings).toEqual([]);
  });

  it("warns rather than rejecting, because the operator is the control", () => {
    // A draft with a problem still comes back — flagged. Silently
    // discarding it teaches nobody anything.
    const warnings = verifyDraft(
      { titles: { en: "Apartment" }, descriptions: { en: "A bargain with clear title." } },
      facts,
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(Array.isArray(warnings)).toBe(true);
  });
});
