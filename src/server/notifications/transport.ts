import { createResendTransport } from "./resend";

/*
 * Message delivery.
 *
 * A transport takes an already-rendered message and puts it on the wire.
 * It does not know what a "template" is — that moved to templates.ts,
 * because copy needs the recipient's locale, their lot, and the same
 * money and date formatters the site uses, none of which belong in a
 * thing whose job is an HTTP call.
 *
 * Resend when RESEND_API_KEY is set, the console stub otherwise. The
 * fallback is what keeps the test suites from sending real email, and it
 * is why the check is on the key rather than on NODE_ENV: a production
 * box with no key must not silently start mailing, and a developer with
 * a key in .env can exercise the real thing.
 */

export type Deliverable = {
  to: string;
  subject: string;
  text: string;
};

export interface Transport {
  send(message: Deliverable): Promise<void>;
}

/*
 * Logs loudly and says what it is, because a stub that looks like a
 * success is how "we never wired up email" reaches production.
 */
export const devConsoleTransport: Transport = {
  async send({ to, subject, text }) {
    console.log(
      [
        "",
        "┌─ EMAIL NOT SENT — development transport ─────────────",
        `│ to:      ${to}`,
        `│ subject: ${subject}`,
        "│",
        ...text.split("\n").map((line) => `│ ${line}`),
        "└──────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  },
};

/**
 * The address messages come from.
 *
 * Resend will refuse anything on a domain that has not been verified in
 * the account, which is the correct behaviour and the most common reason
 * a first send 422s.
 */
const FROM = process.env.MAIL_FROM ?? "Auction House <onboarding@resend.dev>";

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey && process.env.NODE_ENV === "production") {
  console.warn(
    "[notifications] RESEND_API_KEY is not set. Messages will be queued and logged, " +
      "not delivered. Every outbound email on this instance is going nowhere.",
  );
}

export const transport: Transport = apiKey
  ? createResendTransport(apiKey, FROM)
  : devConsoleTransport;
