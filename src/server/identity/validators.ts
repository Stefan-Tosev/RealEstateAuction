/*
 * Bulgarian identifier, phone and date validators.
 *
 * Ported from js/register.js, which docs/server-validation.md calls a
 * "UX layer that an attacker never executes". These are the versions
 * that count. The rules must stay identical to the client's — the shared
 * fixture file in tests/fixtures/registration-cases.json is what stops
 * them drifting (§9).
 *
 * Pure functions, no I/O, so the whole matrix can be tested directly.
 */

// ---------- Character hygiene ----------

/*
 * Control characters, zero-width characters and bidi overrides (§3).
 *
 * The bidi ones are the reason this exists rather than a simple trim:
 * U+202E flips rendering direction, so "Ivanexe.pdf" displays as
 * something quite different from what is stored. It has no business in a
 * name field.
 */
const FORBIDDEN_CHARS = new RegExp(
  "[" +
    "\u0000-\u001F" + // C0 controls
    "\u007F-\u009F" + // DEL and C1 controls
    "\u200B-\u200F" + // zero-width, LTR and RTL marks
    "\u202A-\u202E" + // bidi embedding and overrides
    "\u2066-\u2069" + // bidi isolates
    "]",
);

export function hasForbiddenChars(value: string): boolean {
  return FORBIDDEN_CHARS.test(value);
}

// ---------- Names ----------

/*
 * Letters, marks, spaces, apostrophes, dots and hyphens, starting with a
 * letter. `\p{L}` rather than `[A-Za-z]`: an ASCII-only pattern on a
 * Bulgarian site is a guaranteed defect, and it also rejects "O'Brien"
 * and "Smith-Jones" for everyone else.
 */
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u;

export function isValidName(value: string): boolean {
  if (value.length === 0 || value.length > 70) return false;
  if (hasForbiddenChars(value)) return false;
  return NAME_PATTERN.test(value);
}

// ---------- ЕИК / BULSTAT ----------

/** 9-digit base, two-pass mod-11. */
function isValidEik9(d: number[]): boolean {
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10];

  let sum = 0;
  for (let i = 0; i < 8; i++) sum += d[i] * w1[i];
  let r = sum % 11;
  if (r < 10) return r === d[8];

  // Only when the first pass yields 10 does the second weighting apply.
  sum = 0;
  for (let i = 0; i < 8; i++) sum += d[i] * w2[i];
  r = sum % 11;
  if (r === 10) r = 0;
  return r === d[8];
}

/** 13-digit branch numbers extend a valid 9-digit root. */
function isValidEik13(d: number[]): boolean {
  if (!isValidEik9(d.slice(0, 9))) return false;

  const w1 = [2, 7, 3, 5];
  const w2 = [4, 9, 5, 7];

  let sum = 0;
  for (let i = 0; i < 4; i++) sum += d[8 + i] * w1[i];
  let r = sum % 11;
  if (r < 10) return r === d[12];

  sum = 0;
  for (let i = 0; i < 4; i++) sum += d[8 + i] * w2[i];
  r = sum % 11;
  if (r === 10) r = 0;
  return r === d[12];
}

/**
 * Checksum only. It catches typos and transposed digits, which is most
 * of what goes wrong — but it says nothing about whether the company
 * exists. Verification against the Commercial Register is a §3
 * requirement and belongs with the Stage 2 KYC work.
 */
export function isValidEik(raw: string): boolean {
  if (!/^\d+$/.test(raw)) return false;
  const d = [...raw].map(Number);
  if (d.length === 9) return isValidEik9(d);
  if (d.length === 13) return isValidEik13(d);
  return false;
}

/** `BG` followed by a checksum-valid ЕИК. VIES existence checking is deferred. */
export function isValidVat(raw: string): boolean {
  const match = /^BG(\d{9}|\d{13})$/.exec(raw);
  return match ? isValidEik(match[1]) : false;
}

// ---------- Phone ----------

/**
 * Normalise to E.164 (§2 step 5). Runs before validation — validating
 * first produces false rejections on perfectly good input.
 */
export function normalisePhone(raw: string): string {
  const compact = raw.replace(/[\s()\-.]/g, "");

  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("359")) return `+${compact}`;
  // A leading zero is the Bulgarian trunk prefix: 02… is +3592…
  if (compact.startsWith("0")) return `+359${compact.slice(1)}`;
  return compact;
}

/*
 * Bulgarian numbers, then generic E.164 for foreign bidders. Deliberately
 * permissive: real verification is possession, via an SMS code, not a
 * regex. Rejecting a valid foreign number costs a bidder; accepting a
 * malformed one costs nothing, because the OTP will simply never arrive.
 */
const BG_PHONE = /^\+359[2-9]\d{7,8}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidPhone(normalised: string): boolean {
  return BG_PHONE.test(normalised) || E164.test(normalised);
}

// ---------- Date of birth ----------

export type DateParts = { year: number; month: number; day: number };

/** Strict `YYYY-MM-DD`, rejecting impossible calendar dates like 1990-02-31. */
export function parseDateOfBirth(raw: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  /*
   * Round-trip through Date to reject 31 February and friends. Built in
   * UTC purely as a calendar calculator — no timezone meaning is
   * attached to the result, which is why the age comparison below never
   * touches it.
   */
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Today in Europe/Sofia, as civil calendar parts. */
export function todayInSofia(now: Date = new Date()): DateParts {
  // `sv-SE` formats as YYYY-MM-DD, which parses without ambiguity.
  const [year, month, day] = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);

  return { year, month, day };
}

/**
 * Whole years between two civil dates.
 *
 * §3: "Age must be computed in a fixed civil timezone (Europe/Sofia), not
 * UTC. Naive UTC arithmetic shifts the date backwards for Bulgaria and
 * lets someone register the day before their 18th birthday."
 *
 * Done as integer comparison on calendar parts, so no instant, offset or
 * DST transition can perturb it. The 18th-birthday-today case must pass,
 * and does — the birthday is not "not yet reached" when the parts match.
 */
export function ageOn(birth: DateParts, today: DateParts): number {
  let age = today.year - birth.year;

  const hadBirthday =
    today.month > birth.month || (today.month === birth.month && today.day >= birth.day);
  if (!hadBirthday) age -= 1;

  return age;
}

export const MIN_AGE = 18;
export const MAX_AGE = 120;

export type DobResult =
  | { ok: true; parts: DateParts }
  | { ok: false; code: "INVALID_FORMAT" | "FUTURE_DATE" | "UNDERAGE" | "IMPLAUSIBLE" };

export function checkDateOfBirth(raw: string, now: Date = new Date()): DobResult {
  const parts = parseDateOfBirth(raw);
  if (!parts) return { ok: false, code: "INVALID_FORMAT" };

  const today = todayInSofia(now);
  const age = ageOn(parts, today);

  // A future date reads as a negative age; name it properly rather than
  // reporting it as "underage".
  if (age < 0) return { ok: false, code: "FUTURE_DATE" };
  if (age < MIN_AGE) return { ok: false, code: "UNDERAGE" };
  if (age > MAX_AGE) return { ok: false, code: "IMPLAUSIBLE" };

  return { ok: true, parts };
}

// ---------- Email ----------

/*
 * Deliberately permissive. A strict RFC 5322 pattern rejects addresses
 * that work, and the only real proof an address is reachable is sending
 * to it — which this flow does anyway.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u;

export function isValidEmailFormat(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (hasForbiddenChars(value)) return false;
  return EMAIL_PATTERN.test(value);
}

/** The part before the last `@`, lowercased — used by the password context check. */
export function emailLocalPart(value: string): string {
  const at = value.lastIndexOf("@");
  return (at === -1 ? value : value.slice(0, at)).toLowerCase();
}
