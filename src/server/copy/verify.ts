import type { DraftWarning, DraftedCopy, PropertyFacts } from "./types";

/*
 * Checking the draft against the facts, after the fact.
 *
 * A prompt is a request. This is the part that does not depend on the
 * model having complied — and it exists because the failure mode here is
 * a misdescription the auction house is legally answerable for, not a
 * typo.
 *
 * Warnings, never rejections. The operator reviews and edits before
 * anything is saved, so the useful thing is to point at the sentence
 * worth reading twice. Silently discarding a draft would teach nobody
 * anything; blocking on a false positive would just get the check
 * switched off.
 */

/*
 * Legal and financial vocabulary, in the languages copy is drafted for.
 * Matching is on word boundaries and case-insensitive.
 *
 * Deliberately broad. A false positive costs an operator two seconds of
 * reading; a missed claim about clear title costs considerably more.
 */
const FORBIDDEN_TERMS: Record<string, string[]> = {
  en: [
    "title deed",
    "clear title",
    "freehold",
    "encumbrance",
    "encumbrances",
    "mortgage",
    "lien",
    "charge-free",
    "debt-free",
    "tax",
    "taxes",
    "planning permission",
    "permit",
    "bargain",
    "below market",
    "investment opportunity",
    "yield",
    "guaranteed",
  ],
  bg: [
    "нотариален акт",
    "тежести",
    "ипотека",
    "възбрана",
    "данък",
    "данъци",
    "данъчна оценка",
    "разрешение за строеж",
    "изгодна",
    "под пазарната",
    "инвестиционна възможност",
    "доходност",
    "гарантирана",
  ],
};

/** Numbers that carry no factual claim and would only create noise. */
const HARMLESS_NUMBERS = new Set(["1", "2", "3", "4", "5", "10", "100"]);

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forbiddenIn(locale: string, text: string): string[] {
  const terms = FORBIDDEN_TERMS[locale] ?? [];
  const found: string[] = [];

  for (const term of terms) {
    /*
     * Unicode-aware boundaries: \b is defined on ASCII word characters,
     * so it does not fire correctly around Cyrillic. Looking for a
     * non-letter on each side works for both scripts.
     */
    const pattern = new RegExp(`(^|[^\\p{L}])${escape(term)}($|[^\\p{L}])`, "iu");
    if (pattern.test(text)) found.push(term);
  }

  return found;
}

/** Every number the facts license the copy to use. */
function supportedNumbers(facts: PropertyFacts): Set<string> {
  const supported = new Set<string>(HARMLESS_NUMBERS);

  for (const value of [facts.rooms, facts.areaSqm, facts.floor, facts.yearBuilt]) {
    if (value !== null) {
      supported.add(String(value));
      // 65.00 sqm is written "65" by any sane copywriter.
      if (Number.isInteger(value)) supported.add(String(Math.trunc(value)));
      else supported.add(String(Math.round(value)));
    }
  }

  // The operator's notes are facts too, and often where a number like a
  // plot size or a garage count legitimately comes from.
  for (const match of `${facts.notes} ${facts.address}`.matchAll(/\d+/g)) {
    supported.add(match[0]);
  }

  return supported;
}

export function verifyDraft(copy: DraftedCopy, facts: PropertyFacts): DraftWarning[] {
  const warnings: DraftWarning[] = [];
  const supported = supportedNumbers(facts);

  for (const [locale, description] of Object.entries(copy.descriptions)) {
    const text = `${copy.titles[locale] ?? ""}\n${description}`;

    for (const term of forbiddenIn(locale, text)) {
      warnings.push({
        locale,
        kind: "forbidden-topic",
        detail: `Mentions "${term}". Legal and financial claims belong in the legal pack, not in copy the house is answerable for.`,
      });
    }

    for (const match of text.matchAll(/\d+/g)) {
      if (!supported.has(match[0])) {
        warnings.push({
          locale,
          kind: "unsupported-number",
          detail: `Uses the number ${match[0]}, which is not in the facts supplied. Check it before saving.`,
        });
      }
    }
  }

  return warnings;
}
