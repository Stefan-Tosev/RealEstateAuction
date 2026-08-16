---
name: definition-of-done
description: State what "done" means before starting work, and report against it afterwards. Use when beginning any non-trivial task — a feature, a fix, a refactor — and again when reporting the result. Also use when asked what will be verified, or when a task's acceptance criteria are unclear.
---

# Definition of done

Three lines before the work. The same three, answered, after it.

The point is that it is **falsifiable**. A "Checks" table written after the
fact lists whatever happened to get run and cannot fail. Stated first, it
can — which is the only version worth having.

## Before

```
DoD:         <what "done" means, in one line>
Proof:       <what will demonstrate it, in checkable terms>
Won't prove: <what remains unverified when this is finished>
Test level:  <unit / e2e / screenshot / none — and why not a cheaper one>
```

Then stop and let the user accept, trim or raise it. Usually one word
back. Do not start until they have answered, unless the task is trivial.

### The lines, and what each is for

**DoD** — the outcome, not the activity. "Bidders cannot place an
off-step bid" beats "fix the bidding test".

**Proof** — mechanically checkable. An exit code, a test count, a
screenshot, a grep of a generated artefact. If grading it later needs a
judgement call, the line is written badly. "It works" is not proof.

**Won't prove** — the most valuable line. Every defect found in this
repo's audits lived exactly here: a page verified only by a screenshot,
a guard that could not see the column it guarded, a test passing for
reasons unrelated to its name. Naming the gap costs a sentence now and
saves finding it in three days.

**Test level** — forces the choice to be deliberate in *both*
directions. A unit test for UI wiring tests React, not us. An e2e test
for pure arithmetic is slow and vague. Say which and why the cheaper
option was rejected.

## Tiers

- **Trivial** — docs edit, rename, one-line change. No DoD. Just do it.
- **Normal** — the DoD line and the proof line. No ceremony.
- **High-stakes** — money, bids, identity, deposits, or the deploy path.
  All four lines, and do not self-certify: the proof must be something
  the user could re-run themselves.

The hard rule that sits underneath: **anything touching money, bids,
identity or deposits needs domain-level unit coverage.** Not because
unit tests are virtuous, but because those rules must be re-runnable in
seconds without a browser, and they are what somebody reads to
understand the rule.

## After

Report against the stated text **verbatim**, including anything missed.
A miss is not an apology — it is an entry with a mechanism:

> DoD said the prod suite green. I reported green from a piped exit
> code, which was `tail`'s status and not the suite's.

That sentence is worth more than the fix, because it compounds. An
apology does not.

## When the user sets the bar lower

If they say "quick check is fine", **mean it**. Do the cheap thing,
report it as the cheap thing, and do not quietly do the expensive thing
anyway. A cheap tier that gets silently ignored is not a tier.

If something later escapes through that gap, it is not their failure —
it is the agreed trade working as designed. Say what escaped and what
would have caught it, and leave the choice where it belongs.

## What this does not license

Scope beyond the DoD needs asking, not flagging afterwards. If work
starts suggesting an extra assertion, a config change, a fix to
something adjacent — surface it *before* doing it. Cheaper for the user
to veto than to review.
