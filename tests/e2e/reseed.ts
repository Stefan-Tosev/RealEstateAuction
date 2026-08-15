/*
 * Refresh the seeded catalogue before a suite runs.
 *
 * The catalogue's close dates are stored as offsets from seed time, so a
 * database seeded yesterday has lots that have since closed — and the
 * suite then fails on countdowns and urgency badges with nothing
 * actually broken. That cost a full debugging round: "Приключил" where a
 * ticking clock was expected looks exactly like a bug.
 *
 * Phase 3 raised the stakes. There is now a worker that genuinely closes
 * lots whose clock has run out, and a spec that exercises it will close
 * any seeded lot that has aged past its close time — so a stale database
 * does not merely look wrong, it gets rewritten mid-run and unrelated
 * specs start failing on the lot count.
 *
 * This lives in its own module because *both* configs need it and only
 * the dev one needs route warming. Folding it into the dev global setup
 * is what hid the problem: playwright.prod.config.ts dropped globalSetup
 * to skip warming and silently gave up re-seeding with it.
 *
 * The seed is idempotent and upserts by natural key, so this refreshes
 * the timings without disturbing anything a spec creates for itself.
 */
export async function reseed(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  try {
    await promisify(execFile)("npm", ["run", "db:seed"], { shell: true, timeout: 60_000 });
    console.log("[setup] re-seeded the catalogue");
  } catch (error) {
    // Not fatal: a spec that needs the data will fail with a far more
    // specific message than anything this could print.
    console.warn("[setup] re-seed failed:", (error as Error).message.split("\n")[0]);
  }

  await clearRateLimits();
}

/**
 * Forget every recorded rate-limit hit before a run.
 *
 * The registration specs deliberately submit the form many times, and
 * §6 allows five registrations per IP per hour. While the limiter lived
 * in process memory this was self-solving: Playwright restarts the
 * server for each run, and the counts went with it. In Postgres they
 * persist, so the *second* suite run within an hour got a rate-limit
 * refusal where it expected field errors — a failure that looks like
 * broken validation and is nothing of the sort.
 *
 * CI never sees it, because every run gets a fresh database. It is
 * purely a local trap, which is the worst kind: green on the machine
 * that decides merges, red on the machine trying to check the work.
 *
 * Clearing before rather than asserting empty after: a run legitimately
 * leaves hits behind, and what matters is that runs do not inherit each
 * other's.
 */
async function clearRateLimits(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const { count } = await prisma.rateLimitHit.deleteMany({});
    if (count > 0) console.log(`[setup] cleared ${count} rate-limit hit(s)`);
  } catch (error) {
    console.warn("[setup] could not clear rate limits:", (error as Error).message.split("\n")[0]);
  } finally {
    await prisma.$disconnect();
  }
}

/** Production build: everything is compiled ahead of time, so seed only. */
export default async function globalSetup(): Promise<void> {
  await reseed();
}
