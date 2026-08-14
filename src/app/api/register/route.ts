import { NextResponse } from "next/server";
import { hit, LIMITS } from "@/server/identity/rate-limit";
import { register, type RegistrationInput } from "@/server/identity/registration";

/*
 * POST /api/register — docs/server-validation.md §1.
 *
 * Two rules shape everything here:
 *
 *  - Always 202 for a well-formed request, whether or not the address
 *    already exists (§5). The body, the status and the timing are all
 *    identical; only the email that gets sent differs.
 *
 *  - Codes, never prose (§1). The site renders every string bilingually
 *    and the client owns the copy — an English message from the API
 *    would bypass the language toggle and reach a Bulgarian user
 *    untranslated.
 */

export const dynamic = "force-dynamic";

/** §8: this form has no reason to be larger. */
const MAX_BODY_BYTES = 16 * 1024;

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

export async function POST(request: Request) {
  /*
   * §8: reject anything but JSON. text/plain is specifically called out
   * because it does not trigger a CORS preflight, so accepting it would
   * make this endpoint reachable cross-origin by a simple form post.
   */
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ errors: [{ field: "_body", code: "UNSUPPORTED_MEDIA_TYPE" }] }, {
      status: 415,
    });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ errors: [{ field: "_body", code: "TOO_LARGE" }] }, { status: 413 });
  }

  let body: RegistrationInput;
  try {
    body = JSON.parse(raw) as RegistrationInput;
  } catch {
    return NextResponse.json({ errors: [{ field: "_body", code: "INVALID_JSON" }] }, {
      status: 400,
    });
  }

  const ip = clientIp(request);
  const email = typeof body.email === "string" ? body.email : "";

  /*
   * §6. Keys are HMACed inside the limiter so its store never becomes a
   * plaintext list of everyone who tried to register.
   *
   * 429 is a deliberate exception to the "always 202" rule: it reveals
   * only that *this client* has been busy, which it already knows, and
   * says nothing about whether any address exists.
   */
  const limited =
    (ip ? await hit("reg:ip:hour", ip, LIMITS.registrationPerIpHour) : false) ||
    (ip ? await hit("reg:ip:day", ip, LIMITS.registrationPerIpDay) : false) ||
    (email ? await hit("reg:email:hour", email, LIMITS.registrationPerEmailHour) : false);

  if (limited) {
    return NextResponse.json({ errors: [{ field: "_form", code: "RATE_LIMITED" }] }, {
      status: 429,
      headers: { "retry-after": "3600" },
    });
  }

  const origin = new URL(request.url).origin;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? origin;

  const result = await register(body, {
    ip,
    userAgent: request.headers.get("user-agent"),
    /*
     * §7: the exact wording rendered beside each checkbox, stored
     * verbatim with the consent. "User accepted terms" without the
     * wording and version is unusable in a dispute.
     */
    wording: {
      terms:
        "Съгласен съм с Общите условия и Политиката за поверителност. / " +
        "I agree to the Terms and Conditions and the Privacy Policy.",
      marketing:
        "Искам да получавам известия за нови лотове. / " +
        "I would like to receive notifications about new lots.",
    },
    baseUrl,
  });

  if (result.status === "invalid") {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }

  return NextResponse.json({ status: "pending_verification" }, { status: 202 });
}
