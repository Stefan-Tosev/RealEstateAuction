/*
 * Fallback for a property with no photographs. Every seeded property has
 * images, so this is a defensive path rather than a routine one — but a
 * lot published through the admin UI before its photos are uploaded must
 * still render, and a broken image icon on a luxury listing is worse
 * than an abstract gradient.
 *
 * Carries forward v1's `.lot-image-N` gradient classes (css/styles.css).
 */

/** `.lot-image-1` … `.lot-image-8` are defined in src/styles/catalogue.css. */
const GRADIENT_COUNT = 8;

/**
 * Deterministic, so server and client agree during hydration and a lot
 * keeps the same gradient across page loads. Seeded from the slug rather
 * than an index, so inserting a lot doesn't reshuffle everything after it.
 */
export function gradientClassFor(seed: string): string {
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 100_000;
  }
  return `lot-image-${(hash % GRADIENT_COUNT) + 1}`;
}
