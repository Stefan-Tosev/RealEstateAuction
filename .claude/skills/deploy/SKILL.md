---
name: deploy
description: Deploying Auction House to the production server, or diagnosing it when it is down. Use when asked to deploy, release, ship, restart the site, roll back, check why the site or the worker is down, why lots are not closing, why email is not arriving, or how the server is set up.
---

# Deploying and operating the server

`deploy/README.md` is the authoritative runbook — a bare Ubuntu box to a
running site, top to bottom. This is the map over it: which situation you
are in, and what is worth knowing before you touch anything.

## Which situation is this?

**Deploying a change to a server that already runs.** One command:

```bash
cd /srv/auction && ./deploy/deploy.sh
```

Do not hand-roll the steps. The script's ordering is the point (below),
and it refuses to run over uncommitted changes on the server — somebody
editing a file in place to fix something urgent, then deploying over it,
silently reintroduces the bug.

**Standing up a new server.** Follow `deploy/README.md` from step 0. Do
not skip step 3 (swap) on a 4 GB box: `next build` gets OOM-killed and
the failure reads like a compiler bug, not a memory problem.

**Something is broken.** Jump to *When it is down* below.

## The deploy order, and why it is that order

`deploy/deploy.sh` does: fetch → `npm ci` → `db:generate` → **build** →
stop worker → `prisma migrate deploy` → restart app → start worker →
curl `/api/time` until it answers.

Three constraints hold that shape together:

1. **Build before stopping anything.** The build takes minutes and does
   not touch the database, so the old version keeps serving. Only the
   final restart is downtime.
2. **Stop the worker before migrating.** It closes lots inside
   transactions; altering a table underneath one is the worst possible
   moment.
3. **Migrate before restarting the app, never after.** New code against
   an old schema fails on every request.

`prisma migrate deploy`, never `migrate dev` — `dev` tries to author a
migration and prompts for a name, which on a server means it hangs
forever. See the `migrations` skill for the authoring side.

## Two services, and the worker is not optional

`auction-app` serves the site. `auction-worker` closes lots and drains
the email outbox. **Nothing closes a lot without the worker running** —
a lot sails past its close and stays open, which the admin `/admin/live`
page now surfaces as a red banner precisely because it is otherwise
invisible.

The units are hardened: the filesystem is read-only apart from `media/`,
`private/` and `.next/`. A permission error on an unexpected path means
`ReadWritePaths` needs that path — comment the hardening out to confirm,
then add the path back rather than leaving it off.

systemd parses `.env` itself, and not like a shell: quotes are stripped,
but there is no `$VAR` expansion and no command substitution. A service
refusing to start with an environment-file complaint is a malformed
line, not a code bug.

## Rolling back

The script prints the exact command when the health check fails:

```bash
git checkout <old-sha> && npm ci && npm run build && sudo systemctl restart auction-app
```

**A rollback does not undo a migration.** Reverting code is cheap;
reverting a schema is not. If the bad deploy included a migration,
check whether the old code can still run against the new schema before
rolling back — usually it can, because migrations here are additive, but
verify rather than assume.

## Three environment variables whose absence is silent

Each of these fails by doing nothing rather than by erroring, which is
why they are worth checking first:

| Missing | Symptom |
|---|---|
| `CRON_SECRET` | The closing endpoint refuses every request. No lot ever closes. |
| `RESEND_API_KEY` | Every message is queued and logged instead of sent. Nobody can register, because verification never arrives. |
| `AUTH_URL` | Admin login works locally and fails on the server. Auth.js validates the request Host in production and trusts it in development. |

`RESEND_API_KEY` has a second trap: turning the key on does **not**
deliver the backlog, because the console stub already succeeded and
stamped `sentAt`. See `docs/email-setup.md`.

## When it is down

In order:

1. `systemctl status auction-app auction-worker caddy` — is the process
   even running?
2. `curl -i http://127.0.0.1:3000/api/time` — "active" only means the
   process exists, not that the site answers. This distinguishes an app
   problem from a proxy or TLS problem.
3. `journalctl -u auction-app -n 100 --no-pager` — the app's own story.
   Swap in `auction-worker` for lots not closing or email not arriving,
   `caddy` for certificate problems.
4. Check the `.env` variables above before reading code.
5. `sudo systemctl restart auction-app auction-worker caddy` — last, not
   first. A restart destroys the state that explains the failure.

## Backups

`deploy/backup.sh` runs nightly from the `auction` user's crontab.
**Verify a restore, not just that the file exists** — an untested backup
is a belief, not a backup. And read the bottom of that script: the
on-server copy protects you from deleting a row, not from losing the
server, which is the failure that ends businesses.

## What this deliberately does not have

No zero-downtime deploys, no Docker, no monitoring. Each is argued for
at the end of `deploy/README.md`. If you are about to add one, read that
first — the reasoning is about this project's actual scale, not dogma.
