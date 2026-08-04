import { createHash } from "node:crypto";
import { emailLocalPart } from "./validators";

/*
 * Password policy, per NIST SP 800-63B and docs/server-validation.md §4.
 *
 * The shape of this is deliberate and worth not "improving" later:
 * length over composition. No forced uppercase, digit or symbol, no
 * forced rotation, and every printable character allowed including
 * spaces and emoji. Composition rules push people towards Password1!
 * and away from passphrases, which is the opposite of what they were
 * meant to achieve.
 */

export const MIN_LENGTH = 12;
/** Long passphrases must work. The cap exists only to bound hashing cost. */
export const MAX_LENGTH = 128;

export type PasswordCode =
  | "REQUIRED"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "CONTAINS_PERSONAL"
  | "BREACHED";

/**
 * NFKC before hashing (§4). Without it, two visually identical
 * passwords typed on different keyboards — composed vs decomposed
 * accents — hash differently, and the user is locked out by something
 * they cannot see.
 */
export function normalisePassword(raw: string): string {
  return raw.normalize("NFKC");
}

export type PersonalContext = {
  email?: string;
  firstName?: string;
  lastName?: string;
};

/**
 * Reject a password containing the email local part or either name
 * (§4, ≥4 characters, case-insensitive).
 *
 * Short fragments are ignored on purpose: forbidding every password
 * containing a two-letter surname would reject a great many good ones
 * for no security gain.
 */
export function containsPersonal(password: string, context: PersonalContext): boolean {
  const haystack = password.toLowerCase();

  const needles = [
    context.email ? emailLocalPart(context.email) : null,
    context.firstName?.toLowerCase() ?? null,
    context.lastName?.toLowerCase() ?? null,
  ].filter((n): n is string => Boolean(n) && n!.length >= 4);

  return needles.some((needle) => haystack.includes(needle));
}

/** Length and personal-context rules. No network, so always cheap. */
export function checkPasswordLocally(
  raw: string,
  context: PersonalContext,
): PasswordCode | null {
  if (!raw) return "REQUIRED";

  const password = normalisePassword(raw);

  // Count code points, not UTF-16 units, or an emoji passphrase is
  // measured at roughly double its real length.
  const length = [...password].length;
  if (length < MIN_LENGTH) return "TOO_SHORT";
  if (length > MAX_LENGTH) return "TOO_LONG";

  if (containsPersonal(password, context)) return "CONTAINS_PERSONAL";

  return null;
}

/*
 * HaveIBeenPwned range API, k-anonymity (§4).
 *
 * Only the first five characters of the SHA-1 leave this process. The
 * service returns every suffix sharing that prefix — several hundred —
 * and the comparison happens here. The password itself is never sent,
 * and HIBP cannot tell which of the returned hashes was being asked
 * about.
 */
const HIBP_URL = "https://api.pwnedpasswords.com/range";
const HIBP_TIMEOUT_MS = 2500;

export type BreachResult =
  | { checked: true; breached: boolean; count: number }
  /** The service was unreachable. Deliberately not a failure — see below. */
  | { checked: false; breached: false; count: 0 };

export async function checkBreached(raw: string): Promise<BreachResult> {
  const sha1 = createHash("sha1").update(normalisePassword(raw), "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const response = await fetch(`${HIBP_URL}/${prefix}`, {
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      headers: {
        // Opts into padded responses: every reply is bulked out with
        // decoys so response *size* cannot hint at the answer either.
        "Add-Padding": "true",
        "User-Agent": "auction-house-registration",
      },
    });

    if (!response.ok) return { checked: false, breached: false, count: 0 };

    for (const line of (await response.text()).split("\n")) {
      const [candidate, countRaw] = line.trim().split(":");
      if (candidate === suffix) {
        const count = Number.parseInt(countRaw ?? "0", 10);
        // Padding decoys are returned with a count of 0.
        if (count > 0) return { checked: true, breached: true, count };
      }
    }

    return { checked: true, breached: false, count: 0 };
  } catch {
    /*
     * Fail OPEN, on purpose.
     *
     * A third party being down must not take registration down with it.
     * The alternative — refusing every signup while HIBP is unreachable —
     * hands anyone who can disrupt that one host the ability to close the
     * auction house's front door. The local rules still apply, and this
     * check is re-run on password change.
     */
    return { checked: false, breached: false, count: 0 };
  }
}

/** Local rules, then the breach check. Returns the first failing code. */
export async function checkPassword(
  raw: string,
  context: PersonalContext,
): Promise<PasswordCode | null> {
  const local = checkPasswordLocally(raw, context);
  if (local) return local;

  const breach = await checkBreached(raw);
  return breach.breached ? "BREACHED" : null;
}
