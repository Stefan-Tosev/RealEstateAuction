#!/usr/bin/env node
/*
 * Refuse to run a verification command whose exit code will be thrown away.
 *
 * `npm test | tail -5` reports TAIL's exit status, not the suite's. On
 * 2026-08-15 that produced three separate false readings in one session,
 * including a full e2e run reported as passing while it had failed one
 * test and skipped eleven. The output said what a pass looks like and the
 * exit code said 0, so nothing about it looked wrong.
 *
 * This is deliberately a hook rather than a note in CLAUDE.md. The
 * failure mode is not forgetting the rule — it is not noticing the pipe,
 * and an instruction cannot catch what nobody looked at. A hook can.
 *
 * Reads the PreToolUse payload on stdin. Exit 2 blocks the call and shows
 * stderr to Claude; exit 0 allows it.
 */

const VERIFICATION = /\b(npm\s+(run\s+)?(test|build|typecheck)|npx\s+(playwright|vitest|tsc)|playwright\s+test|vitest|prisma\s+migrate|check-clean)/;

/* Pipes that swallow the status of what came before them. */
const SWALLOWING_PIPE = /\|\s*(tail|head|grep|sed|awk|sort|uniq|wc)\b/;

/* Ways of keeping the real status anyway — all legitimate. */
const PRESERVES_STATUS = /PIPESTATUS|\$\{pipestatus|set\s+-o\s+pipefail|>\s*\S+\.log|>\s*\/tmp\/|>\s*"?\$\{?\w*(TMP|TEMP)/i;

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let command = "";
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    // A payload we cannot read is not grounds for blocking the user's work.
    process.exit(0);
  }

  if (!VERIFICATION.test(command)) process.exit(0);
  if (!SWALLOWING_PIPE.test(command)) process.exit(0);
  if (PRESERVES_STATUS.test(command)) process.exit(0);

  process.stderr.write(
    "Blocked: this pipes a verification command into a filter, so $? will be the\n" +
      "filter's exit status and not the command's. That has produced false passes\n" +
      "in this repo — a failing e2e run reported as green.\n\n" +
      "Redirect to a file and read the real status:\n\n" +
      "  npm test > /tmp/out.log 2>&1; echo \"exit: $?\"; tail -5 /tmp/out.log\n\n" +
      "Or keep the pipe and check PIPESTATUS explicitly.\n",
  );
  process.exit(2);
});
