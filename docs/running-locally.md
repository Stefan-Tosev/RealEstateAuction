# Running it locally

From a machine with nothing installed to the site on `localhost:3000`.

`deploy/README.md` is the equivalent for a real server. This one is for
looking at what exists — it takes shortcuts a deployment must not, and
says where.

Written 2026-08-12, against a Windows 10 laptop where Docker Desktop
4.86.0 had just been installed and WSL2 had not been enabled. Steps 1
and 2 are one-time; after that, starting up is step 5 onwards and takes
about a minute.

---

## What you get, and what you don't

Phase 1 is built: the public catalogue, the admin, and bidder accounts.
Bidding, deposits and the soft-close engine are not — see
`docs/architecture.md` for where they sit in the build order.

Two things behave differently here than they would in production, both
deliberately:

- **No email is delivered.** `RESEND_API_KEY` is empty, so every message
  is queued and printed to the terminal in a box instead of sent. Step 7
  shows how to complete a registration anyway.
- **Invoices are marked SPECIMEN** and numbered in a separate `DEMO-`
  series, because `INVOICE_DEMO_MODE` is on and no company registration
  exists yet. That is the correct setting until it does.

---

## 1. Enable WSL2 — one time, needs a reboot

Docker Desktop on Windows runs its engine inside WSL2. If WSL is not
enabled the daemon never starts, and the symptom is unhelpful: Docker
Desktop appears to be running, its window is open, and every `docker`
command reports that it cannot find the pipe.

Check first, in any terminal:

```powershell
wsl --list --verbose
```

If that prints a table of distributions, WSL is fine — skip to step 2.
If it prints the wsl.exe **usage text**, the feature is off. That is the
confusing part: it looks like you mistyped the command, not like
anything is missing.

Open PowerShell **as Administrator** and run:

```powershell
wsl --install --no-distribution
```

`--no-distribution` is deliberate. Docker ships its own `docker-desktop`
distro; installing Ubuntu as well gives you a second Linux to maintain
for no benefit.

**Then reboot.** Enabling the Virtual Machine Platform feature does not
take effect until you do, and no amount of restarting Docker will
substitute for it.

---

## 2. Docker Desktop — one time

Already installed on the laptop as of the date above. On a fresh machine:

```powershell
winget install -e --id Docker.DockerDesktop
```

Launch it once from the Start menu and **accept the service agreement**.
It will not start the engine until you have, and it gives no hint from
the command line that it is waiting on a dialog.

Confirm the engine is actually up before going further:

```powershell
docker version
```

You want a **Server** section in that output. Client-only means the
daemon is still down, and everything below will fail in ways that look
like database problems.

---

## 3. The database

```bash
cd D:\repos\RealEstateAuction
docker compose up -d
```

That is Postgres 16, on 5432, with the user, password and database name
already matching the `DATABASE_URL` in `.env`. Data lives in a named
Docker volume, so it survives `docker compose down` and stopping the
machine — but **not** `docker compose down -v`, which deletes it.

Unlike the server install, there is no manual `CREATE EXTENSION citext`
step. The Compose database hands the app's role ownership of the
container, so the init migration creates the extension itself.

Check it answers:

```bash
docker compose ps
```

---

## 4. Dependencies, schema, demo data

```bash
npm ci
npm run db:generate
npm run db:migrate       # 14 migrations as of writing
npm run db:seed
```

`npm run db:seed` is idempotent and **refreshes the relative dates** —
lots that were closing "in three days" when it last ran will be three
days out again. Re-run it any time the demo catalogue has drifted into
the past. It also creates the operator account from `ADMIN_EMAIL` and
`ADMIN_PASSWORD` in `.env`, and only on the first run; changing those
values later will not change the account.

---

## 5. Start it — two terminals

**Terminal 1:**

```bash
npm run dev
```

**Terminal 2:**

```bash
npm run worker
```

**Nothing closes a lot without the worker.** It polls the closing and
outbox endpoints every five seconds. It refuses to start at all without
`CRON_SECRET`, which is set in `.env` — that refusal is deliberate, not
a bug.

**Check nothing else holds port 3000 before you start.** If something
does, Next binds 3001 instead and says so quietly, while the worker goes
on talking to 3000 and finding nothing. Lots silently stop closing.

---

## 6. Where to look

| What | URL |
|---|---|
| Catalogue, Bulgarian | http://localhost:3000/bg/lots |
| Catalogue, English | http://localhost:3000/en/lots |
| Register | http://localhost:3000/bg/register |
| Sign in | http://localhost:3000/bg/sign-in |
| Admin | http://localhost:3000/admin/login |

The admin login is the `ADMIN_EMAIL` / `ADMIN_PASSWORD` pair in `.env`.

Both languages are real, separate URLs with their own `hreflang`
alternates — not one page toggling with CSS. Worth switching between
them, since it is the thing most likely to be wrong after a change.

---

## 7. Completing a registration with no email

Register at `/bg/register`. The verification message will **not** arrive.
Instead it prints to the `npm run dev` terminal inside a box:

```
┌─ EMAIL NOT SENT — development transport ──────────
│ to:      you@example.com
│ subject: ...
```

Copy the verification link out of that box and open it. The account then
behaves exactly as a verified one.

The box is loud on purpose. A stub that looked like a success is how
"we never wired up email" reaches production.

---

## 8. Tests

```bash
npm test               # unit, vitest, no database needed
npm run test:e2e       # against next dev
npm run test:e2e:prod  # builds first, then next start
```

The e2e suites hit the **real** database, so step 3 has to be up.

**Run `npm run clean` when switching between the dev and prod e2e
suites.** The prod run leaves a production build in `.next`, and the dev
run then recompiles from it slowly enough to produce dozens of failures
that look real and are not.

The suite is strong on behaviour and blind to layout. A whole suite has
twice been green while a page rendered with no shell at all — look at the
page after a visual change.

---

## 9. Stopping, and picking it up again

```bash
# Ctrl-C both terminals, then, if you want the database down too:
docker compose stop
```

Next time: `docker compose up -d`, then step 5. Steps 1, 2 and 4 do not
need repeating unless migrations have been added — `npm run db:migrate`
is harmless when there is nothing to apply.

---

## When something is wrong

| Symptom | Cause |
|---|---|
| `docker` cannot find the pipe; Docker Desktop looks like it is running | Engine down — WSL2 not enabled (step 1) or the agreement not accepted (step 2) |
| `wsl --status` prints usage text | The WSL feature is off, not a typo. Step 1 |
| Prisma cannot reach the database | `docker compose ps` — the container is stopped |
| Site loads, nothing ever closes | Worker not running, or Next is on 3001 and the worker is talking to 3000 |
| No verification email | Expected. Step 7 |
| Dozens of e2e failures right after a prod run | Stale `.next` — `npm run clean` |
| Demo lots all show as closed | Re-run `npm run db:seed` to refresh the relative dates |
| Build killed with no error message | Out of memory. Not seen on a laptop, but it is what happens on a small server |

---

## What this is not

This is not a deployment, and none of it should be copied to one:

- The database password is `auctionhouse`, in a file in the repository.
- `AUTH_URL` is `http://localhost:3000`. On a server this must be the
  real https origin, or admin login works in testing and fails in
  production — this project has already hit exactly that.
- Uploads go to `media/` and `private/` on the local disk with no backup.

`deploy/README.md` is the real thing, and `docs/open-items.md` §1 is what
still stands between this and a launch — of which the server is one item
of four, and not the expensive one.
