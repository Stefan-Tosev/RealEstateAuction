import type { AccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueue } from "@/server/notifications/outbox";
import { transport } from "@/server/notifications/transport";
import { hashPassword } from "./password";
import { checkPassword, normalisePassword, type PasswordCode } from "./password-policy";
import {
  checkDateOfBirth,
  hasForbiddenChars,
  isValidEik,
  isValidEmailFormat,
  isValidName,
  isValidPhone,
  isValidVat,
  normalisePhone,
} from "./validators";
import { issueVerificationToken } from "./verification";

/*
 * Bidder registration, Stage 1 — account creation only.
 *
 * ЕГН, identity documents and proof of funds are deliberately out of
 * scope: they belong to Stage 2, behind manual review.
 *
 * The whole design constraint here is docs/server-validation.md §5:
 * "An attacker registering victim@example.com must not learn whether
 * that account exists." Everything below is arranged so that a duplicate
 * and a new address are indistinguishable in the response body, the
 * status code, and the time taken.
 */

/** The current terms version. Bump when the wording changes. */
export const POLICY_VERSION = "2026-08-01";

export type FieldError = { field: string; code: string };

export type RegistrationInput = {
  accountType: unknown;
  firstName: unknown;
  lastName: unknown;
  email: unknown;
  phone: unknown;
  dateOfBirth: unknown;
  companyName: unknown;
  eik: unknown;
  vat: unknown;
  password: unknown;
  terms: unknown;
  marketing: unknown;
  website: unknown;
  locale?: unknown;
};

export type RegistrationContext = {
  ip: string | null;
  userAgent: string | null;
  /** Exact strings rendered beside the checkboxes, stored verbatim (§7). */
  wording: { terms: string; marketing: string };
  baseUrl: string;
};

/** §2 step 1: bounds before decoding, to cap parser cost. */
const MAX_LENGTHS: Record<string, number> = {
  firstName: 70,
  lastName: 70,
  email: 254,
  phone: 32,
  dateOfBirth: 10,
  companyName: 160,
  eik: 13,
  vat: 16,
  password: 128,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/*
 * §2, in order. Normalising after validating produces false rejections
 * on input that is perfectly good once tidied.
 */
function normalise(input: RegistrationInput) {
  const text = (value: unknown) => asString(value).normalize("NFC").trim();
  const collapsed = (value: unknown) => text(value).replace(/\s+/g, " ");

  return {
    accountType: text(input.accountType),
    firstName: collapsed(input.firstName),
    lastName: collapsed(input.lastName),
    // Stored as submitted; compared case-insensitively. Lowercasing for
    // storage is data loss — the local part is technically case-sensitive.
    email: text(input.email),
    phone: normalisePhone(text(input.phone)),
    dateOfBirth: text(input.dateOfBirth),
    companyName: collapsed(input.companyName),
    eik: text(input.eik),
    vat: text(input.vat).toUpperCase().replace(/\s/g, ""),
    // NFKC, and never trimmed — leading and trailing spaces are legal.
    password: normalisePassword(asString(input.password)),
    terms: input.terms,
    marketing: input.marketing,
    website: asString(input.website),
    locale: text(input.locale) === "en" ? "en" : "bg",
  };
}

type Normalised = ReturnType<typeof normalise>;

function validate(value: Normalised): FieldError[] {
  const errors: FieldError[] = [];
  const add = (field: string, code: string) => errors.push({ field, code });

  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const raw = asString((value as unknown as Record<string, unknown>)[field]);
    if (raw.length > max) add(field, "TOO_LONG");
  }

  if (value.accountType !== "individual" && value.accountType !== "company") {
    add("accountType", "INVALID_VALUE");
  }

  for (const field of ["firstName", "lastName"] as const) {
    const raw = value[field];
    if (!raw) add(field, "REQUIRED");
    else if (hasForbiddenChars(raw)) add(field, "INVALID_CHARS");
    else if (!isValidName(raw)) add(field, "INVALID_CHARS");
  }

  if (!value.email) add("email", "REQUIRED");
  else if (!isValidEmailFormat(value.email)) add("email", "INVALID_FORMAT");

  if (!value.phone) add("phone", "REQUIRED");
  else if (!isValidPhone(value.phone)) add("phone", "INVALID_FORMAT");

  if (!value.dateOfBirth) add("dateOfBirth", "REQUIRED");
  else {
    const dob = checkDateOfBirth(value.dateOfBirth);
    if (!dob.ok) add("dateOfBirth", dob.code);
  }

  if (value.accountType === "company") {
    if (!value.companyName) add("companyName", "REQUIRED");
    if (!value.eik) add("eik", "REQUIRED");
    else if (!/^\d{9}$|^\d{13}$/.test(value.eik)) add("eik", "INVALID_FORMAT");
    else if (!isValidEik(value.eik)) add("eik", "CHECKSUM_FAILED");
  }

  // Optional even for a company, but must be well-formed if present.
  if (value.vat) {
    if (!/^BG\d{9}$|^BG\d{13}$/.test(value.vat)) add("vat", "INVALID_FORMAT");
    else if (!isValidVat(value.vat)) add("vat", "CHECKSUM_FAILED");
  }

  /*
   * §3: exactly boolean true. "true", 1 and "on" are all rejected —
   * truthiness is not consent, and a checkbox serialised loosely by some
   * client must not be able to accept terms on a person's behalf.
   */
  if (value.terms !== true) add("terms", "NOT_ACCEPTED");

  if (typeof value.marketing !== "boolean") add("marketing", "INVALID_VALUE");

  return errors;
}

export type RegistrationResult =
  | { status: "pending_verification" }
  | { status: "invalid"; errors: FieldError[] };

/**
 * §5 step 3: "Constant-time response. Do the Argon2id work either way,
 * or pad to a fixed floor." A fast success and a slow one is a working
 * oracle no matter what the body says.
 */
const RESPONSE_FLOOR_MS = 700;

async function padTo(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < RESPONSE_FLOOR_MS) {
    await new Promise((resolve) => setTimeout(resolve, RESPONSE_FLOOR_MS - elapsed));
  }
}

export async function register(
  input: RegistrationInput,
  context: RegistrationContext,
): Promise<RegistrationResult> {
  const startedAt = Date.now();
  const value = normalise(input);

  /*
   * §6 honeypot: a filled hidden field means a bot. Return the ordinary
   * success shape and discard silently — telling it that it was caught
   * only teaches the next version to leave the field alone.
   */
  if (value.website) {
    await padTo(startedAt);
    return { status: "pending_verification" };
  }

  const errors = validate(value);

  // Password rules need the name and email for the context check, so
  // they run after the field validation rather than inside it.
  if (!errors.some((e) => e.field === "password")) {
    const code: PasswordCode | null = await checkPassword(value.password, {
      email: value.email,
      firstName: value.firstName,
      lastName: value.lastName,
    });
    if (code) errors.push({ field: "password", code });
  }

  if (errors.length > 0) {
    await padTo(startedAt);
    return { status: "invalid", errors };
  }

  // Citext column, so this comparison is case-insensitive in the database
  // without lowercasing anything for storage.
  const existing = await prisma.user.findUnique({
    where: { email: value.email },
    select: { id: true },
  });

  /*
   * The single branch that matters, and it changes only which message
   * gets sent — never the response. Both paths do the Argon2id work.
   */
  const passwordHash = await hashPassword(value.password);

  if (existing) {
    await enqueue({
      userId: existing.id,
      channel: "email",
      template: "registration_attempt_existing_account",
      payload: { signInUrl: `${context.baseUrl}/${value.locale}/sign-in` },
    });
    await transport.send({
      to: value.email,
      template: "registration_attempt_existing_account",
      payload: { note: "Someone tried to register with this address. Sign in or reset instead." },
    });

    await padTo(startedAt);
    return { status: "pending_verification" };
  }

  const dob = checkDateOfBirth(value.dateOfBirth);
  if (!dob.ok) {
    // Unreachable — validate() already checked it. Guards the type.
    await padTo(startedAt);
    return { status: "invalid", errors: [{ field: "dateOfBirth", code: dob.code }] };
  }

  const isCompany = value.accountType === "company";

  const user = await prisma.user.create({
    data: {
      email: value.email,
      passwordHash,
      firstName: value.firstName,
      lastName: value.lastName,
      phone: value.phone,
      // Stored as a date, never as a computed age — age is derived at
      // read time so it cannot go stale (§7).
      dateOfBirth: new Date(Date.UTC(dob.parts.year, dob.parts.month - 1, dob.parts.day)),
      accountType: value.accountType as AccountType,
      /*
       * §3: "Never trust accountType to decide what to store." An
       * individual submitting company fields gets them discarded rather
       * than persisted unvalidated.
       */
      companyName: isCompany ? value.companyName : null,
      eik: isCompany ? value.eik : null,
      vat: isCompany && value.vat ? value.vat : null,
      locale: value.locale as "bg" | "en",
      consents: {
        create: [
          {
            kind: "terms",
            granted: true,
            policyVersion: POLICY_VERSION,
            wording: context.wording.terms,
            ip: context.ip,
            userAgent: context.userAgent,
          },
          {
            // Recorded either way. A declined marketing consent is itself
            // a fact worth being able to prove.
            kind: "marketing",
            granted: value.marketing === true,
            policyVersion: POLICY_VERSION,
            wording: context.wording.marketing,
            ip: context.ip,
            userAgent: context.userAgent,
          },
        ],
      },
    },
    select: { id: true },
  });

  const token = await issueVerificationToken(user.id);
  const verifyUrl = `${context.baseUrl}/${value.locale}/verify?token=${token}`;

  await enqueue({
    userId: user.id,
    channel: "email",
    template: "verify_email",
    payload: { verifyUrl },
  });
  await transport.send({
    to: value.email,
    template: "verify_email",
    payload: { verifyUrl },
  });

  await padTo(startedAt);
  return { status: "pending_verification" };
}
