/*
 * Message delivery.
 *
 * Development transport: writes to the server log rather than sending.
 * The flow around it is real — real tokens, real expiry, real single
 * use — so nothing here is pretending an email was delivered when it
 * was not. Swapping in a provider (Resend, Postmark, SES, plain SMTP)
 * replaces this one file.
 *
 * It logs loudly and says what it is, because a stub that looks like a
 * success is how "we never wired up email" reaches production.
 */

export type Deliverable = {
  to: string;
  template: string;
  payload: Record<string, unknown>;
};

export interface Transport {
  send(message: Deliverable): Promise<void>;
}

export const devConsoleTransport: Transport = {
  async send({ to, template, payload }) {
    const lines = [
      "",
      "┌─ EMAIL NOT SENT — development transport ─────────────",
      `│ to:       ${to}`,
      `│ template: ${template}`,
    ];

    for (const [key, value] of Object.entries(payload)) {
      lines.push(`│ ${key}: ${String(value)}`);
    }

    lines.push("└──────────────────────────────────────────────────────", "");
    console.log(lines.join("\n"));
  },
};

export const transport: Transport = devConsoleTransport;
