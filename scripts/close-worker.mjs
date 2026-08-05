import "dotenv/config";

/*
 * Drives the closing endpoint on an interval — §3 asks for "a worker
 * every few seconds".
 *
 * Deliberately dumb: it holds no state, makes no decisions, and can be
 * killed and restarted at any moment. All the logic lives behind the
 * endpoint, which is idempotent and safe to call concurrently, so
 * running two of these is wasteful but not wrong.
 *
 * For a real deployment, prefer whatever scheduler the platform already
 * has — this exists so local development and a plain VPS have something
 * that works without one.
 *
 * Run: node scripts/close-worker.mjs
 */

const BASE = process.env.WORKER_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 5000);

if (!SECRET) {
  console.error(
    "CRON_SECRET is not set. The closing endpoint refuses every request without it,\n" +
      "which is deliberate — see src/app/api/internal/close-lots/route.ts.",
  );
  process.exit(1);
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    console.log(`\n${signal} — finishing the current pass and stopping.`);
  });
}

async function tick() {
  try {
    const response = await fetch(`${BASE}/api/internal/close-lots`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });

    if (!response.ok) {
      console.error(`close-lots returned ${response.status}`);
      return;
    }

    const result = await response.json();
    // Quiet unless something happened — a worker that logs every few
    // seconds trains you to ignore it.
    if (result.outcomes.length > 0) {
      console.log(
        new Date().toISOString(),
        `closed=${result.closed} reserveNotMet=${result.reserveNotMet} extended=${result.extended}`,
      );
    }
  } catch (error) {
    // A missing server is the ordinary case in development. Keep going.
    console.error("close-lots call failed:", error.message);
  }
}

console.log(`Closing worker: ${BASE} every ${INTERVAL_MS}ms. Ctrl-C to stop.`);

while (!stopping) {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
