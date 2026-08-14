# Turning on email

Everything in the code is finished: the outbox table, the dispatcher that
drains it, ten bilingual templates, and a Resend transport. What is
missing is an account, a verified domain and a key — none of which are
code, which is why this is a runbook and not a ticket.

Until `RESEND_API_KEY` is set, **no message reaches anybody**, verification
emails included. That means nobody can complete registration.

---

## What already exists

| Piece | Where | State |
|---|---|---|
| Queue | `src/server/notifications/outbox.ts` | Written in the same transaction as the event that caused it |
| Dispatcher | `src/server/notifications/dispatch.ts` | Claims rows with `FOR UPDATE SKIP LOCKED`; safe to run more than one |
| Templates | `src/server/notifications/templates.ts` | Rendered in the *recipient's* locale, not the sender's |
| Transport | `src/server/notifications/resend.ts` | Plain `fetch`, no SDK |
| Selection | `src/server/notifications/transport.ts` | Resend when the key is set, console stub otherwise |

The dispatcher only runs when the worker does — `npm run worker`. Nothing
is delivered without it, the same way nothing closes without it.

---

## 1. Create the account

Sign up at resend.com. The free tier is ample for this.

Take the API key and put it in `.env`:

```
RESEND_API_KEY="re_..."
```

**Restart the dev server afterwards.** The transport reads the key once at
module load, so a running server keeps using the console stub no matter
what the file says.

---

## 2. Prove it works today, without a domain

You do not have to wait for the domain to arrive. Resend has a shared
sandbox sender, already the default in `.env.example`:

```
MAIL_FROM="Auction House <onboarding@resend.dev>"
```

It has one restriction: **it only delivers to the address you signed up
to Resend with.** Any other recipient is refused. That is enough to prove
the account, the key, the transport, the dispatcher and the templates all
work together.

To test, register a bidder using your own Resend signup address at
`/bg/register`, with the worker running. The verification email should
arrive within a few seconds.

If it does not, look at the worker's window first — a refusal is printed
there with Resend's own explanation of why.

---

## 3. When the domain exists

Add the domain in Resend and it generates the DNS records for you. Create
them at the registrar exactly as shown, then wait for Resend to report the
domain verified. Typically that is a DKIM record, an SPF record, and
optionally MX records so bounces come back to Resend rather than
disappearing.

**Send from a subdomain**, `mail.auctionhouse.bg` rather than the root.
If a spam problem ever develops, it damages the reputation of the domain
that sent the mail — and you do not want that to be the domain the website
lives on.

Then set the From address to something on the verified domain:

```
MAIL_FROM="Auction House <no-reply@mail.auctionhouse.bg>"
```

Resend refuses any domain not verified in the account. **A 422 on the
first real send is almost always this**, not a bad key.

---

## 4. Also set the site URL

```
NEXT_PUBLIC_SITE_URL="https://auctionhouse.bg"
```

Every link in every email is built from it — verification links included.
Left at `http://localhost:3000` in production, the mail sends perfectly
and every link in it is useless.

---

## Things that will bite

**Switching the key on does not deliver the backlog.** The console stub
*succeeds*, so every message it logged was marked sent and will never be
retried. Anyone who registered before the key existed has a verification
email that went to a terminal. They need to register again, or be verified
by hand.

**A failing message is retried five times**, backing off 1, 2, 4, 8 and 16
minutes, and is then abandoned. It is left unsent rather than marked sent,
deliberately: the row is the evidence somebody was never told. Look for
rows in `outbox` with `attempts >= 5` and `sent_at IS NULL`.

**A message whose template name nothing recognises is marked sent and
logged loudly.** It is not a delivery failure — it means an enqueue site
and `templates.ts` disagree about the name, which is a bug to fix rather
than a retry to wait out.

**The queue is drained by the worker.** In production that is
`auction-worker.service`; locally it is `npm run worker` or `start.cmd`.
No worker, no mail, however correct the key is.
