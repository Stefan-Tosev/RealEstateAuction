import "dotenv/config";

/*
 * Drives the two scheduler endpoints on an interval — closing lots (§3
 * asks for "a worker every few seconds") and draining the outbox.
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

async function call(path) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
  });

  if (!response.ok) {
    console.error(`${path} returned ${response.status}`);
    return null;
  }

  return response.json();
}

async function tick() {
  try {
    const closed = await call("/api/internal/close-lots");
    const mail = await call("/api/internal/send-outbox");

    // Quiet unless something happened — a worker that logs every few
    // seconds trains you to ignore it.
    const lines = [];
    if (closed && (closed.outcomes.length > 0 || closed.negotiationsExpired > 0)) {
      lines.push(
        `closed=${closed.closed} reserveNotMet=${closed.reserveNotMet} extended=${closed.extended} negotiationsExpired=${closed.negotiationsExpired}`,
      );
    }
    if (mail && (mail.sent || mail.retry || mail.abandoned || mail.unknownTemplate)) {
      lines.push(
        `mail sent=${mail.sent} retry=${mail.retry} abandoned=${mail.abandoned} unknownTemplate=${mail.unknownTemplate}`,
      );
    }
    if (lines.length > 0) console.log(new Date().toISOString(), lines.join(" | "));
  } catch (error) {
    // A missing server is the ordinary case in development. Keep going.
    console.error("worker pass failed:", error.message);
  }
}

console.log(`Worker: ${BASE} every ${INTERVAL_MS}ms — closing lots and sending mail. Ctrl-C to stop.`);

while (!stopping) {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
