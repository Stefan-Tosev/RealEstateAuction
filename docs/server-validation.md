# Server-side validation spec — bidder registration (Stage 1)

Companion to `register.html` / `js/register.js`.

**The client validates nothing.** `js/register.js` is a UX layer that an attacker never executes. Every rule below must be enforced server-side, independently, on every request. Where a rule already exists client-side, the server rule must be *identical* — see [§9 Parity](#9-parity-testing) for how to stop the two drifting apart.

Scope is **Stage 1 only**: account creation. ЕГН, identity documents and proof of funds belong to Stage 2 and are out of scope here.

---

## 1. Endpoint contract

```
POST /api/register
Content-Type: application/json
```

```jsonc
{
  "accountType": "individual" | "company",
  "firstName":   "string",
  "lastName":    "string",
  "email":       "string",
  "phone":       "string",          // as typed; server normalises
  "dateOfBirth": "YYYY-MM-DD",
  "companyName": "string|null",     // required when accountType = company
  "eik":         "string|null",     // required when accountType = company
  "vat":         "string|null",     // optional even for company
  "password":    "string",
  "terms":       true,              // must be exactly true
  "marketing":   boolean,
  "website":     ""                 // honeypot; must be absent or empty
}
```

### Response — always the same shape, always `202`

```jsonc
// 202 Accepted — ALWAYS returned on a well-formed request,
// whether or not the email already exists. See §5.
{ "status": "pending_verification" }
```

```jsonc
// 400 Bad Request — validation failure
{
  "errors": [
    { "field": "email", "code": "INVALID_FORMAT" },
    { "field": "eik",   "code": "CHECKSUM_FAILED" }
  ]
}
```

> ### ⚠ Return codes, never prose
>
> The server must **not** return human-readable messages. This site renders every string as paired `data-bg`/`data-en` spans; an English string from the API would bypass the language toggle and appear untranslated to Bulgarian users — exactly the bug we fixed by removing native validation bubbles.
>
> The client owns the copy and maps `code` → paired spans. This also keeps the API locale-agnostic and avoids shipping translations into the backend.

---

## 2. Normalisation — before validation, in this order

Order matters; validating before normalising produces false rejections.

| Step | Rule |
|---|---|
| 1 | Reject the whole request if any string field exceeds its max length **before** decoding — bounds first, to cap parser cost |
| 2 | Unicode **NFC** on all text fields (NFKC on password only, before hashing) |
| 3 | Trim leading/trailing whitespace on every field **except** `password` |
| 4 | Collapse internal runs of whitespace in `firstName`, `lastName`, `companyName` |
| 5 | `phone` → E.164 (`00` → `+`, bare `359…` → `+359…`, leading `0` → `+359`) |
| 6 | `vat` → uppercase, strip spaces |
| 7 | `email` — store **as submitted**; compare **case-insensitively** on the whole address |

⚠ Do not lowercase the email for storage. The local part is technically case-sensitive; lowercasing for comparison is pragmatic, lowercasing for storage is data loss.

---

## 3. Field rules

Mirror of the client, plus what only a server can do.

| Field | Rule | Error code |
|---|---|---|
| `accountType` | Exactly `individual` or `company` | `INVALID_VALUE` |
| `firstName` / `lastName` | Non-empty; ≤70 chars; `^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$` | `REQUIRED` / `TOO_LONG` / `INVALID_CHARS` |
| `email` | Non-empty; ≤254; permissive pattern; **domain must have an MX or A record** | `REQUIRED` / `INVALID_FORMAT` / `UNROUTABLE_DOMAIN` |
| `phone` | After normalisation: `^\+359[2-9]\d{7,8}$` or `^\+[1-9]\d{7,14}$` | `REQUIRED` / `INVALID_FORMAT` |
| `dateOfBirth` | Strict `YYYY-MM-DD`; real calendar date; not future; age ≥18; ≤120 | `INVALID_FORMAT` / `FUTURE_DATE` / `UNDERAGE` / `IMPLAUSIBLE` |
| `companyName` | Required iff company; ≤160 | `REQUIRED` / `TOO_LONG` |
| `eik` | Required iff company; 9 or 13 digits; two-pass mod-11 checksum; **verify against the Commercial Register** | `REQUIRED` / `INVALID_FORMAT` / `CHECKSUM_FAILED` / `NOT_FOUND` |
| `vat` | Optional; `^BG\d{9}$\|^BG\d{13}$`; digits must pass ЕИК checksum; **validate against VIES** | `INVALID_FORMAT` / `CHECKSUM_FAILED` / `VIES_UNKNOWN` |
| `password` | See §4 | |
| `terms` | Must be **exactly boolean `true`** — reject `"true"`, `1`, `"on"` | `NOT_ACCEPTED` |
| `marketing` | Boolean; **must not affect whether registration succeeds** | — |
| `website` | Absent or `""`, else drop the request (see §6) | — |

**Reject on all fields:** control chars, zero-width chars, and bidi overrides — `[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]`.

⚠ **Age must be computed in a fixed civil timezone (Europe/Sofia), not UTC.** Naive UTC arithmetic shifts the date backwards for Bulgaria and lets someone register the day before their 18th birthday. The "18th birthday is today" case must succeed.

⚠ **Never trust `accountType` to decide what to store.** If a client sends `accountType: "individual"` with company fields populated, discard the company fields rather than persisting unvalidated data.

---

## 4. Password handling

Per **NIST SP 800-63B**:

| | |
|---|---|
| Length | ≥12 required, **≥64 must be accepted**; hard cap 128 |
| Charset | All printable Unicode, incl. spaces and emoji |
| Composition rules | **None** — no forced upper/digit/symbol |
| Rotation | **None** — no forced expiry |
| Breach check | **Required.** HaveIBeenPwned range API (k-anonymity: send the first 5 SHA-1 chars only, never the password) → `BREACHED` |
| Context check | Reject if it contains the email local part, first or last name (≥4 chars, case-insensitive) → `CONTAINS_PERSONAL` |
| Normalisation | NFKC **before** hashing |
| Hash | **Argon2id**, m ≥ 19 MiB, t ≥ 2, p = 1, 16-byte salt, 32-byte output |

⚠ **Never log, echo, or include the password in error responses, traces, or APM payloads.** Add it to the scrubbing denylist explicitly — default scrubbers usually catch `password` but miss nested or renamed copies.

⚠ Hash with a **constant-cost** path even when the request is going to fail for other reasons, or response timing reveals which emails exist.

---

## 5. Account enumeration — the rule most implementations get wrong

An attacker registering `victim@example.com` must not learn whether that account exists.

1. Return `202 { "status": "pending_verification" }` **in both cases**.
2. Branch only in the *email that gets sent*:
   - **New address** → verification link, valid 24 h, single-use, ≥128 bits entropy, hashed at rest.
   - **Existing address** → "someone tried to register with your address; sign in or reset your password."
3. **Constant-time response.** Do the Argon2id work either way, or pad to a fixed floor (e.g. 400 ms). A fast "success" versus a slow one is a working oracle regardless of the response body.
4. Apply the same discipline to password reset and sign-in.

⚠ Do not add a "check email availability" endpoint for inline UX. It is an enumeration oracle by construction.

---

## 6. Abuse controls

| Control | Setting |
|---|---|
| Per-IP rate limit | 5 registrations/hour, 20/day, exponential backoff |
| Per-email rate limit | 3 attempts/hour |
| CAPTCHA | After 3 failures from an IP; always for datacentre/VPN ranges |
| Honeypot (`website`) | Non-empty → return `202` and **silently discard**. Never reveal the trap |
| Time gate | Submitted <2 s after page load → discard as above |
| Idempotency | Accept an `Idempotency-Key` header; replay returns the original response (defends double-click and retries) |
| Disposable domains | Block a maintained throwaway-domain list — this is a KYC flow |
| Global breaker | Alert and throttle on registration-rate anomalies |

⚠ Rate-limit keys must be **hashed** (`HMAC(email)`), not raw addresses, so the limiter store isn't a plaintext user list.

---

## 7. Persistence, consent and retention

**Record with every consent:** timestamp (UTC), source IP, user agent, **policy version**, and the exact wording rendered. "User accepted terms" without the version is unusable in a dispute.

- `terms` and `marketing` stored as **separate, independently revocable** records. Withdrawing marketing consent must never disable the account.
- Store `dateOfBirth`, not a computed age — age is derived at read time.
- Encrypt PII at rest; separate the encryption key from the database credentials.

### Retention

| Data | Retention |
|---|---|
| Unverified registration | Purge after 30 days |
| Verified account | Life of the relationship |
| **AML/KYC records** | **5 years after the relationship ends** |
| Consent records | Relationship + limitation period |
| Marketing opt-in | Until withdrawn |

> ### ⚠ Erasure vs AML — build the conflict in deliberately
>
> High-value real-estate auctioneers are **obliged entities** under AMLD5. The statutory 5-year AML retention **lawfully overrides** a GDPR erasure request for KYC records (GDPR Art. 17(3)(b)).
>
> A "delete my account" flow must therefore **anonymise the profile while preserving the AML record** — not cascade-delete. Discovering this during an audit is significantly more expensive than designing for it now. Get this reviewed by counsel; the exact boundary is jurisdictional.

Sanctions and PEP screening (EU consolidated, OFAC, UN) belong at Stage 2, before a paddle is issued — not at account creation.

---

## 8. Transport and platform

- **HTTPS only**; HSTS with `preload`.
- Session cookies: `Secure`, `HttpOnly`, `SameSite=Lax`, `__Host-` prefix.
- **CSRF token** required if authentication is cookie-based.
- `Content-Type: application/json` enforced; reject `text/plain` (bypasses CORS preflight).
- Request body cap ~16 KB — this form has no reason to be larger.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive CSP.
- Audit log every attempt: timestamp, IP, outcome, **hashed** email. Never the password, never the full address in plaintext.
- **2FA (TOTP) is mandatory before a paddle number is issued**, regardless of whether it is optional at signup. Lots settle in the millions.

---

## 9. Parity testing

The client and server rules **will** drift unless something forces them not to.

1. Keep one shared fixture file — `test/fixtures/registration-cases.json` — with `{ input, expectedCodes }`.
2. Run it against both the client validators and the API in CI. A case passing one and failing the other fails the build.
3. Seed it from the adversarial matrix already covered in `scratchpad/test-validators.js` (35 cases green at time of writing):

**Must be ACCEPTED** (false-rejection bugs): `иван+auction@фирма.bg` · `O'Brien-Смит` · Sofia `02 987 6543` *and* Plovdiv `+35932123456` · `+44 20 7946 0958` · 64-char passphrase with spaces · **18th birthday today**.

**Must be REJECTED:** 18th birthday tomorrow · `1990-02-31` · ЕИК with transposed digits · `Ivan\u202Eexe` · `terms: "true"` (string) · 11-char password · breached password · non-empty honeypot.

**Server-only cases:** duplicate email → `202`, identical body, timing within noise of a new address · 6th registration from one IP in an hour · replayed `Idempotency-Key` · `marketing: false` still succeeds.

---

## 10. Definition of done

- [ ] Every §3 rule enforced server-side and covered by a test
- [ ] Argon2id at the §4 parameters; password absent from all logs
- [ ] Duplicate email indistinguishable from new — body **and** timing
- [ ] Rate limits enforced and alerting
- [ ] Consent rows carry policy version and exact wording
- [ ] Erasure flow anonymises without destroying AML records
- [ ] Parity fixtures green in CI against both client and server
- [ ] Client copy exists in **both** БГ and EN for every error code the API can return
