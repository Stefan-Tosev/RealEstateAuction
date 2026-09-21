# Session economics

One short entry per session, newest at the bottom. What the expensive
parts actually were, what caused it, and what would avoid it next time.
A learning record, not a diary — an entry is worth writing only if it
would change how the next session is run.

Created 19 August 2026. Earlier sessions were not logged, so an absence
of entries before this date means nothing.

---

## 19 August 2026 — NEXT.md went stale inside the same day it was written

Cheap session by token count: two reads of `NEXT.md`, a handful of
greps, no code. The only avoidable cost was the same cost twice.

`NEXT.md` was written on 18 August and three pull requests merged
**after** it. Both times it was read today, the read had to be followed
by `git log` against the file's own date, then a `git show` to work out
what had changed, then a check of `docs/open-items.md` to see whether
the entry it described was still open. It was not: the terms-acceptance
page had shipped, and the file's loudest trap described a lockout that
could no longer happen.

That re-derivation is exactly the work `NEXT.md` exists to prevent, and
it will recur every time the file is read until it is rewritten.

**What would avoid it:** write `NEXT.md` after the last merge of a
session, not before. A file whose header says "trust this" and whose
body predates the last three commits costs more than no file, because
the reader has to establish which half to believe.

**Second-order:** the same staleness had reached `docs/open-items.md`
§3.10, which still read as open. When a session closes an open item,
closing the item in the ledger belongs to the same commit as the code,
not to a later tidy-up that may never come.

## 21 September 2026 — the database was not running, and nothing said so

The expensive part was not the work. It was running the unit suite
against a Postgres that was not there: nineteen tests failed in 82
seconds, every one of them reporting `Can't reach database server`, and
the first read of the log looked like the change had broken invoicing.
Docker Desktop itself was closed, so `docker compose up -d` failed too,
with a message about a named pipe rather than about Docker.

**Next time: check the database before running anything that touches
it.** `docker compose ps` costs nothing and answers in one line. The
suite takes four minutes to tell you the same thing, badly.

Two smaller ones, both worth the minute they cost:

- A full-suite failure in `bidding.test.ts` looked like a regression and
  was an intermittent cross-file race — those assertions counted the
  whole outbox table while `dispatch.test.ts` was filling it in
  parallel. Re-running the suite unchanged was what proved it, and it is
  the cheapest possible test of "is this mine?".
- The seller-facing page was checked by fetching it from a running dev
  server with a script, rather than by writing a Playwright spec. Four
  URLs, four lines of output, about a minute. The spec would have been
  the right tool if the behaviour needed keeping; for "does this page
  render at all" it would have cost ten minutes to learn the same thing.
