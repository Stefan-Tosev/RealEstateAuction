---
name: phase-audit
description: Audit whether a phase's safety net actually holds before the next phase is built on it. Use before starting work that depends on existing functionality, when asked for a QA or refactor session, or when checking whether tests mean what they claim.
---

# Phase audit

Not "run the tests". CI already runs them on every push. This asks the
question CI cannot: **do the tests mean what they say they mean?**

Every defect these audits have found was invisible to a green suite.

## Run it when

- Before building **on** a phase — Phase 2 is bidding, deposits and
  approvals, so its net is worth a session before anything sits on it.
- When the user offers QA time. **Take it.** The standing bias is to
  keep building, and that bias belongs to the one being asked.
- Ad hoc, whenever a claim rests on somebody having looked at it.

## Delegate the sweep

The probes below are read-heavy: many files, most of which turn out to
be fine. Reading them in the main session fills it with file dumps and
ends it early, which is the specific way these audits die half-finished.

So **spawn a subagent for the sweep** — `Explore` for locating and
reading, `general-purpose` when it needs to run the suite or make an
assertion fail. Hand it: the phase under audit, the probes it should
work through, and an instruction to return *findings with evidence* —
mechanism, the command or edit that proved it, and production-defect
versus test-only — not file contents.

Do the interpretation, the fixes and the write-ups in the main session.
The agent finds; you decide. Never accept a finding it did not prove:
"this looks wrong" from an agent is the same claim as "I looked at it"
from a human, and probe 1 exists to catch exactly that.

## The probes

Work through these against the phase's actual code, not from memory.

### 1. What is verified only by having looked at it?

Screenshots, manual checks, "I confirmed it renders". Every one is a
candidate. Ask what test would have caught it being wrong, and whether
that test exists.

### 2. Can each assertion fail?

Take the assertions that matter and **make them fail on purpose**, then
revert. Leak the value they forbid. Break the layout they assume. Delete
the row they expect.

A green test nobody has watched go red is not evidence. In this repo
that has caught: a reserve-price assertion that did bite, a shell
assertion that did, and two tests that were reporting the build mode
rather than the behaviour.

### 3. Does each guard see what it claims to guard?

`check-clean.mjs` asserted the database was "as the seed left it" while a
column sat at a value the seed never wrote. A guard that cannot see the
state it guards is worse than none, because it is believed.

For each guard: list what it inspects, then list what the thing it
protects actually consists of. The difference is the hole.

### 4. Does the seed produce states the engine cannot?

Fixtures drift from reality silently. A lot was seeded `EXTENDING` with
zero extensions — impossible, because the engine sets the status and
increments the count in one statement — and it made the page's main
signal untestable from seeded data.

### 5. Does anything pass for environmental reasons?

Dev versus production divergence is the classic. `next dev` serialises
data production omits; React re-renders differently; controlled inputs
behave differently. If a test would give a different answer under
`next build`, it is reporting the build mode.

### 6. Where does durable state outlive a run?

Anything persisted that nothing resets. The rate limiter moved to
Postgres — correct for production — and the second suite run within an
hour then failed as though validation were broken.

### 7. What does CI never execute?

CI here runs `test:e2e:prod`. It does **not** run the dev suite, which
is how that went red on `main` unnoticed. List what runs only on a
developer's machine, and decide whether that is acceptable.

## Reporting

Findings, each with: the mechanism, how it was proven, and whether it is
a production defect or a test-only one. That distinction matters — the
bidder-id serialisation was dev-only and needed scoping, not fixing.

Fix what is contained. Flag the rest in `docs/open-items.md` with enough
causal detail that it can be picked up cold — what happened, why, and
the routes to closing it.

## Two things to do while you are here

Both are cheap, and this is the only moment either is reliably done.

**Re-read and extend the irreversible list** — the three to five things
in this repo that genuinely cannot be undone. Phase 2 adds deposits and
approvals; a list named once at the top of a project is stale by the
third phase and quietly stops matching the code. The list is what makes
the level checkable: if a diff touches one of these nouns it is
irreversible work, and no judgement call is involved.

**Read `docs/untested.md`** — the append-only ledger of skips: date,
what is untested, what it would have caught. This is the one moment it
is meant to be read. Items are cleared by marking them cleared with a
date, never by deleting them, so "flagged in August, still open in
November" stays visible.

It is a different file from `docs/open-items.md` and they must not be
merged. `open-items.md` is a snapshot of the open set, with closed items
deliberately removed. The ledger is a history, and its value is the
duration it exposes. One deletes, the other never does.

Do not test the ledger by asking whether it is empty — an absence of
entries reads identically to health. Ask instead: **what is the last
thing we decided not to test?** If nobody can name one, it was not
discipline.

## The discipline this rests on

Do not weaken an assertion to get green. If an assertion fails and the
production behaviour is correct, scope it to where it is true and say
why. If it fails and the behaviour is wrong, the test was right.

See also [definition-of-done](../definition-of-done/SKILL.md), whose
"won't prove" line is where the next audit should start looking.
