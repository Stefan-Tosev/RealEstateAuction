import type { Transport } from "./transport";

/*
 * Resend, over plain fetch.
 *
 * No SDK: sending an email is one POST with a JSON body, and the SDK
 * would add a dependency, a version to keep current and a second place
 * for the API shape to live. If webhooks or batch sending are ever
 * wanted, revisit.
 *
 * The queue is what makes this safe to keep simple. A failure here
 * throws, the dispatcher records the attempt, and the message is tried
 * again — so there is no retry logic in this file and there should not
 * be one.
 */

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Rejects on anything that is not a success, so the dispatcher counts
 * the attempt and leaves the row unsent. Swallowing the error here would
 * mark a message delivered that Resend never accepted.
 */
export function createResendTransport(apiKey: string, from: string): Transport {
  return {
    async send({ to, subject, text }) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, text }),
        /*
         * Without a bound, a hung provider holds a dispatcher worker
         * open indefinitely and the queue stops moving for everyone.
         */
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        /*
         * Read the body for the reason — Resend explains refusals
         * properly (unverified domain, invalid recipient, rate limit),
         * and without it the log says only "422" while somebody guesses.
         *
         * The API key is in the request headers, never in the body, so
         * echoing the response cannot leak it.
         */
        const detail = await response.text().catch(() => "");
        throw new Error(`Resend refused the message: ${response.status} ${detail}`.trim());
      }
    },
  };
}
