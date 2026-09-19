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
