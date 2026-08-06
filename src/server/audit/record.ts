import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
 * The audit trail.
 *
 * Every operator mutation lands here. Audit rows cannot be backfilled —
 * six months from now a dispute asks "who moved this reserve, and when",
 * and the only acceptable answer is a row. That is why this exists in
 * the same pass as the first admin write, not later.
 *
 * Deliberately append-only in intent: nothing in the app updates or
 * deletes audit_log. (The bids table has a database trigger enforcing
 * that; this one relies on there being no code path. Worth a trigger of
 * its own when the audit trail starts carrying weight.)
 */

export type AuditEntity = "property" | "lot" | "property_image" | "admin_user";

type RecordInput = {
  /**
   * Null when the actor is the system rather than a person — a
   * negotiation window that expired on the clock, for instance. Putting
   * an operator's name against a decision nobody made is worse than
   * recording that nobody made it.
   */
  actorId: string | null;
  action: string;
  entityType: AuditEntity;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

/*
 * Fields that must never be copied into an audit row. The reserve is
 * server-only but it does legitimately belong in the audit trail —
 * "who changed the reserve" is precisely what this is for. Secrets that
 * are never legitimate to store go here instead.
 */
const REDACTED = new Set(["passwordHash", "password"]);

/**
 * Prisma rows carry bigint and Decimal, neither of which survives
 * JSON.stringify — an unserializable value would throw inside the audit
 * write and take the whole mutation down with it. Nothing is worth
 * losing a legitimate action over a logging failure.
 */
export function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (key, raw) => {
      if (REDACTED.has(key)) return "[redacted]";
      if (typeof raw === "bigint") return raw.toString();
      if (raw instanceof Date) return raw.toISOString();
      if (raw instanceof Prisma.Decimal) return raw.toString();
      return raw;
    }),
  ) as Prisma.InputJsonValue;
}

/*
 * Best-effort client IP. Behind a proxy this is only as trustworthy as
 * the proxy — x-forwarded-for is client-supplied unless something
 * upstream overwrites it. Recorded because it is useful corroboration,
 * never relied on as identity; the actor id is the authoritative part.
 */
async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
    return h.get("x-real-ip");
  } catch {
    // Outside a request context (a script, a test) there are no headers.
    return null;
  }
}

export async function recordAudit(input: RecordInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : toAuditJson(input.before),
      after: input.after === undefined ? undefined : toAuditJson(input.after),
      ip: await clientIp(),
    },
  });
}
