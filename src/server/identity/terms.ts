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
 * The terms version this user last granted, or null if they never have.
 *
 * Latest by grant time, not by insertion: consent is append-only, so a
 * user accumulates a row per version and the newest is the one that
 * binds. Revoked rows are skipped — a withdrawn consent is a fact worth
 * keeping and not one worth acting on.
 *
 * `granted: false` is skipped for the same reason. A recorded refusal is
 * evidence, never permission.
 */
export async function acceptedTermsVersion(
  client: Client,
  userId: string,
): Promise<string | null> {
  const consent = await client.consent.findFirst({
    where: { userId, kind: "terms", granted: true, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { policyVersion: true },
  });
  return consent?.policyVersion ?? null;
}

/**
 * Whether this user has accepted the version in force.
 *
 * A user with no terms consent at all fails, deliberately. Registration
 * always writes one, so the absent case is a row created by something
 * other than registration — a script, a seed, a future admin path — and
 * none of those are grounds to treat someone as bound.
 */
export async function hasAcceptedCurrentTerms(
  client: Client,
  userId: string,
): Promise<boolean> {
  return (await acceptedTermsVersion(client, userId)) === POLICY_VERSION;
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
