import type { Prisma } from "@prisma/client";

/*
 * Which terms a bidder is bound by, and whether they are current.
 *
 * The Consent model already records the version, the exact wording, the
 * IP and the moment (§7). What it could not do on its own was notice
 * that the version had moved on: consent is captured once at
 * registration, so bumping the policy left every existing bidder
 * carrying an agreement to text they had never seen, still bidding.
 *
 * This module is the missing half. placeBid asks it before accepting a
 * bid, so "binding" means bound to a named version rather than to
 * whatever the terms happen to say today.
 */

type Client = Prisma.TransactionClient;

/**
 * The terms version currently in force.
 *
 * ⚠ Do not bump this until a signed-in bidder has a route to accept the
 * new version. placeBid rejects a bid from anyone whose latest granted
 * `terms` consent does not match this string — changing it without an
 * acceptance page locks every existing bidder out of bidding with no way
 * back in. The gate is deliberately strict; the door has to exist first.
 *
 * Bumping it is also the moment to check the old text is still
 * retrievable. A version string is evidence only for as long as the
 * document it names can be produced, which is why the terms documents
 * belong in version control under their version name.
 */
export const POLICY_VERSION = "2026-08-01";

/**
 * Whether this user has accepted the version in force.
 *
 * An existence check, deliberately, rather than "find the newest consent
 * and compare its version".
 *
 * The newest-row phrasing is the obvious one and it is wrong here.
 * `createdAt` is `@default(now())`, which Prisma resolves in JavaScript
 * at **millisecond** resolution — two consents written in the same
 * millisecond carry an identical timestamp, and `ORDER BY created_at
 * DESC` then returns either one. CI caught exactly that: a bidder who
 * had just accepted the current terms was told they were still on the
 * old version, on a machine fast enough to write both rows inside one
 * tick. A bidder locked out of bidding by a tiebreak is not a defect
 * anyone would find by reading the code.
 *
 * Asking "is there a granted, unrevoked consent naming this version?"
 * has no ordering in it, so there is nothing to tie.
 *
 * A user with no terms consent at all fails, deliberately. Registration
 * always writes one, so the absent case is a row created by something
 * other than registration — a script, a seed, a future admin path — and
 * none of those are grounds to treat someone as bound.
 *
 * `granted: false` and revoked rows are both skipped. A recorded refusal
 * and a withdrawn consent are each facts worth keeping and neither is
 * permission.
 */
export async function hasAcceptedCurrentTerms(
  client: Client,
  userId: string,
): Promise<boolean> {
  const consent = await client.consent.findFirst({
    where: {
      userId,
      kind: "terms",
      granted: true,
      revokedAt: null,
      policyVersion: POLICY_VERSION,
    },
    select: { id: true },
  });
  return consent !== null;
}

/**
 * Record acceptance of the version in force.
 *
 * Appends. The earlier row is evidence of what was agreed at the time
 * and is never updated or deleted — the whole value of the trail is
 * that it shows a sequence rather than a current state.
 *
 * `wording` is the exact string rendered beside the checkbox, stored
 * verbatim, matching what registration does. A version number without
 * the words next to it is unusable in a dispute.
 */
export async function recordTermsAcceptance(
  client: Client,
  input: { userId: string; wording: string; ip?: string | null; userAgent?: string | null },
): Promise<void> {
  await client.consent.create({
    data: {
      userId: input.userId,
      kind: "terms",
      granted: true,
      policyVersion: POLICY_VERSION,
      wording: input.wording,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
