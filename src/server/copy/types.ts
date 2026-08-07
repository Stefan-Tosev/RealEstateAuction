/*
 * Drafting listing copy.
 *
 * Writing every description twice is the largest recurring cost of a
 * bilingual catalogue, and it grows linearly with each market added.
 * This drafts from structured facts; an operator reviews and edits before
 * anything is saved. Nothing here writes to the database or publishes.
 *
 * ### Why this is a liability surface, and how that shapes the design
 *
 * Misdescription by an agent is the AGENT's liability — the one part of
 * the legal-pack position where the auction house is exposed rather than
 * the seller. A description that invents a south-facing terrace or a
 * renovation year is exactly that, and "the model wrote it" is not a
 * defence.
 *
 * So three rules run through this module:
 *
 *   1. Only facts that were supplied may appear. No inference, no
 *      plausible-sounding detail, no filling gaps.
 *   2. Legal status is never mentioned — no title, no encumbrances, no
 *      taxes. Those live in the legal pack, which is the seller's
 *      solicitor's work and carries their warranty, not our prose.
 *   3. Every locale must state the same facts. Two descriptions that
 *      disagree about the number of rooms is one of them being wrong.
 *
 * verify.ts enforces 1 and 2 deterministically after generation, because
 * a prompt is a request and not a guarantee.
 */

/** Structured facts, exactly as held on the property row. */
export type PropertyFacts = {
  propertyType: string;
  city: string;
  region: string;
  /** Street and neighbourhood. Never the seller's name. */
  address: string;
  rooms: number | null;
  areaSqm: number | null;
  floor: number | null;
  yearBuilt: number | null;
  /**
   * Free text from the operator: what is actually notable about this
   * property. The single biggest lever on whether the copy is any good,
   * and the only place new facts may enter.
   */
  notes: string;
};

export type DraftedCopy = {
  /** Keyed by locale code, so a new market is a config entry. */
  titles: Record<string, string>;
  descriptions: Record<string, string>;
};

export type DraftWarning = {
  locale: string;
  kind: "forbidden-topic" | "unsupported-number";
  detail: string;
};

export type DraftResult = {
  copy: DraftedCopy;
  /*
   * Surfaced to the operator rather than thrown. A warning means "look
   * at this before you save it", and the operator is the control — this
   * is a drafting tool, not an authority.
   */
  warnings: DraftWarning[];
};
