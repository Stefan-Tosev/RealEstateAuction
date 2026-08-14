/*
 * Making "which statuses count as X?" fail loudly.
 *
 * Written as an array — ["PUBLISHED", "BIDDING_OPEN"] — such a set is
 * silent when a new LotStatus appears. The new status is simply absent,
 * and a lot quietly vanishes from a page with no error anywhere. Written
 * as a Record keyed by the union, the same set does not compile until
 * somebody decides what the new status means.
 *
 * That decision is the point. Each of these sets encodes a product
 * judgement — visible to the public, open for bidding, still worth a
 * publish checklist — and a default is a judgement made by accident.
 *
 * Learned the expensive way: deriving one of them from the transition
 * graph gave a plausible answer that was wrong, because reachability
 * asks a different question than membership does. See the note above
 * CHECKLIST_APPLIES in src/server/catalogue/publish.ts.
 */

/**
 * The keys a Record maps to true, typed as the union rather than as
 * string[] — which is what `Object.keys` alone would give.
 */
export function keysWhere<K extends string>(map: Record<K, boolean>): K[] {
  return (Object.keys(map) as K[]).filter((key) => map[key]);
}

/**
 * Unreachable when every case is handled. If it becomes reachable the
 * argument is no longer `never` and the call stops compiling.
 *
 * Throws rather than returning a fallback: the alternative is a `default`
 * branch quietly picking an answer for a case nobody considered, which is
 * the failure this exists to prevent.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${String(value)}`);
}
