# Untested

Every time verification was proposed and declined, one line. Not an
argument — a record. The risk gets stated once, the decision gets made,
the line gets written, and the work moves on.

The point is that a decision to skip should compound **visibly**. Three
sessions of reasonable individual "not now"s look like nothing at the
time and look like something here.

## Rules

- **Append only.** Never delete a line. An item is closed by filling in
  the *Cleared* column with a date, so "flagged in August, still open in
  November" stays readable. `git diff` on this file should never show a
  removed line.
- **Read at one moment** — before building on top of that area, which in
  practice means during a `phase-audit` session.
- **Different file from `docs/open-items.md`,** which is a snapshot of
  the open set and deliberately drops what is closed. This one is a
  history and drops nothing. Do not merge them.
- Never judge this file by whether it is empty. An absence of entries
  reads exactly like health. Ask instead: *what is the last thing we
  decided not to test?* If nobody can name one, it was not discipline.

## Ledger

| Date | Area | What is untested | What it would have caught | Cleared |
|---|---|---|---|---|
| | | | | |

<!-- No entries yet. That is not evidence of anything; see the last rule. -->
