import type { AdminRole } from "@prisma/client";
import { auth } from "./auth";

/*
 * Authorization for admin actions.
 *
 * Middleware answers "is there a session" and nothing more — it runs on
 * the edge and deliberately does not touch the database. That is the
 * right split, but it means every mutation has to check its own
 * permission here, in the Node runtime, at the point of the action.
 *
 * Never gate on the UI alone. A hidden button is a hint, not a control:
 * server actions are reachable by anyone who can construct a POST.
 */

export class AuthorizationError extends Error {
  constructor(message = "Not permitted.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type AdminActor = {
  id: string;
  email: string;
  name?: string | null;
  role: AdminRole;
};

/** The signed-in operator, or null. */
export async function currentAdmin(): Promise<AdminActor | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.role) return null;

  return { id: user.id, email: user.email ?? "", name: user.name, role: user.role };
}

/** Any signed-in operator. Throws rather than returning null so a caller cannot forget to check. */
export async function requireAdmin(): Promise<AdminActor> {
  const actor = await currentAdmin();
  if (!actor) throw new AuthorizationError("You must be signed in.");
  return actor;
}

/*
 * Actions reserved to the `admin` role.
 *
 * docs/architecture.md §10: "The auctioneer must agree the reserve.
 * Sellers do not set it unilaterally." The same logic applies to the
 * operator side — agreeing a reserve and putting a lot live are
 * commercial commitments, not data entry, so they do not belong to every
 * account with a login.
 *
 * `staff` keeps the day-to-day work: drafting properties, writing copy,
 * uploading photography.
 */
export const ADMIN_ONLY_ACTIONS = [
  "lot.agreeReserve",
  "lot.publish",
  "lot.cancel",
  "lot.editLive",
] as const;

export type AdminOnlyAction = (typeof ADMIN_ONLY_ACTIONS)[number];

export function canPerform(role: AdminRole, action: AdminOnlyAction | string): boolean {
  if (role === "admin") return true;
  return !(ADMIN_ONLY_ACTIONS as readonly string[]).includes(action);
}

/** Require the `admin` role for a named action. */
export async function requireRoleFor(action: AdminOnlyAction): Promise<AdminActor> {
  const actor = await requireAdmin();
  if (!canPerform(actor.role, action)) {
    throw new AuthorizationError("This action is restricted to auctioneer accounts.");
  }
  return actor;
}
