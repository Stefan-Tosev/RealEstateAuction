import { MARKETS, REQUIRED_MARKET_CODES } from "./markets";
import { systemPrompt, userPrompt } from "./prompt";
import type { DraftResult, DraftedCopy, PropertyFacts } from "./types";
import { verifyDraft } from "./verify";

/*
 * Calling Claude for a draft.
 *
 * Plain fetch, no SDK — the same reasoning as resend.ts. This is one POST
 * with a JSON body, and an SDK would add a dependency, a version to keep
 * current and a second place for the API shape to live.
 *
 * Nothing here writes to the database. The result goes back to the form
 * for an operator to read, edit and save, which is what keeps a person
 * between the model and anything published under the house's name.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/*
 * Sonnet 5 rather than Opus: this is short prose from structured facts,
 * a few hundred output tokens a lot, and the quality difference does not
 * show at this length. Overridable per deployment.
 */
const MODEL = process.env.COPY_MODEL ?? "claude-sonnet-5";

export class CopyUnavailable extends Error {}

export function copyDraftingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function draftListingCopy(
  facts: PropertyFacts,
  marketCodes: string[] = REQUIRED_MARKET_CODES,
): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CopyUnavailable(
      "ANTHROPIC_API_KEY is not set, so copy cannot be drafted. Descriptions can still be written by hand.",
    );
  }

  const markets = MARKETS.filter((market) => marketCodes.includes(market.code));
  if (markets.length === 0) throw new CopyUnavailable("No known markets were requested.");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt(),
      messages: [{ role: "user", content: userPrompt(facts, markets) }],
    }),
    // A hung provider must not hold an operator's form open indefinitely.
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new CopyUnavailable(`Claude refused the request: ${response.status} ${detail}`.trim());
  }

  const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = payload.content?.find((block) => block.type === "text")?.text ?? "";

  const copy = parse(text, markets.map((m) => m.code));

  return { copy, warnings: verifyDraft(copy, facts) };
}

/**
 * Read the JSON out of the reply.
 *
 * Tolerates the model wrapping it in a fence or a sentence, because
 * failing an operator's request over a stray "Here you go:" would be a
 * silly way to lose a draft. What it does not tolerate is a missing
 * language: a property saved with one description empty is a broken
 * listing, and the bilingual NOT NULL columns would reject it anyway.
 */
function parse(text: string, expected: string[]): DraftedCopy {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new CopyUnavailable("Claude's reply contained no JSON.");
  }

  let parsed: DraftedCopy;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as DraftedCopy;
  } catch {
    throw new CopyUnavailable("Claude's reply was not valid JSON.");
  }

  const missing = expected.filter(
    (code) => !parsed.titles?.[code]?.trim() || !parsed.descriptions?.[code]?.trim(),
  );
  if (missing.length > 0) {
    throw new CopyUnavailable(`Claude returned nothing for: ${missing.join(", ")}.`);
  }

  return { titles: parsed.titles, descriptions: parsed.descriptions };
}
