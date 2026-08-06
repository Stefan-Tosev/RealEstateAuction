import type { Market } from "./markets";
import type { PropertyFacts } from "./types";

/*
 * Turning property facts into a request for copy.
 *
 * Kept pure and separate from the API call so the prompt can be tested,
 * diffed and argued about without spending a token — and so that what the
 * model is actually asked is readable in one place rather than assembled
 * across a network call.
 */

/**
 * Topics the copy must never touch, whatever the facts say.
 *
 * Legal status belongs to the legal pack, which the seller's solicitor
 * produces and the seller warrants. The moment marketing copy asserts
 * anything about title, the auction house has made the claim itself and
 * owns it — misdescription by an agent is the agent's liability.
 */
const FORBIDDEN_TOPICS = [
  "title, ownership history, or whether title is clear",
  "encumbrances, mortgages, liens, or charges",
  "taxes, tax valuation, or outstanding obligations",
  "planning permission, permits, or regulatory compliance",
  "the seller, their circumstances, or why they are selling",
  "investment returns, yields, or predictions about price",
];

function factLines(facts: PropertyFacts): string {
  const lines: string[] = [
    `Property type: ${facts.propertyType}`,
    `City: ${facts.city}`,
    `Region: ${facts.region}`,
    `Address: ${facts.address}`,
  ];

  // Omitted rather than sent as "unknown": a null in the prompt invites
  // the model to fill it in.
  if (facts.rooms !== null) lines.push(`Rooms: ${facts.rooms}`);
  if (facts.areaSqm !== null) lines.push(`Area: ${facts.areaSqm} sqm`);
  if (facts.floor !== null) lines.push(`Floor: ${facts.floor}`);
  if (facts.yearBuilt !== null) lines.push(`Year built: ${facts.yearBuilt}`);
  if (facts.notes.trim()) lines.push(`Notes from the auctioneer: ${facts.notes.trim()}`);

  return lines.join("\n");
}

export function systemPrompt(): string {
  return [
    "You write listing copy for a real-estate auction house.",
    "",
    "Your copy is published as the auction house's own words, which makes",
    "the house legally responsible for it. A description that states",
    "something untrue is a misdescription the house answers for, so the",
    "constraints below are not style preferences.",
    "",
    "RULES",
    "",
    "1. Use ONLY the facts you are given. Do not add, infer or embellish.",
    "   If you were not told the aspect, the condition, the view, the",
    "   heating, the parking or the state of repair, do not mention them.",
    "   An attractive sentence you cannot source is worse than a plain one.",
    "2. Never write about any of these:",
    ...FORBIDDEN_TOPICS.map((topic) => `   - ${topic}`),
    "3. Every number you write must be one you were given.",
    "4. Do not describe the property as a bargain, an opportunity, or",
    "   priced below value. The price is decided by bidding, not by you.",
    "5. Write for a buyer deciding whether to view. Concrete and specific",
    "   beats warm and general.",
    "",
    "If the facts are too thin for a useful description, write a short",
    "accurate one. Do not pad it.",
  ].join("\n");
}

/**
 * One request covering every market at once.
 *
 * Asking for all locales in a single call is not a token optimisation —
 * it is what keeps them consistent. Separate calls drift, and two
 * descriptions that disagree about the number of rooms means one of them
 * is a misdescription.
 */
export function userPrompt(facts: PropertyFacts, markets: Market[]): string {
  return [
    "Draft a title and a description for this property.",
    "",
    "FACTS",
    factLines(facts),
    "",
    "LANGUAGES",
    ...markets.map((m) => `- ${m.code}: ${m.label}, for ${m.audience}`),
    "",
    "Write each language natively for its own reader. Do not translate one",
    "into the others — but every version must state exactly the same facts.",
    "",
    "Titles: one line, no more than 70 characters, naming the property type",
    "and the area.",
    "Descriptions: two or three short paragraphs.",
    "",
    "Reply with JSON only, no commentary, in exactly this shape:",
    "",
    JSON.stringify(
      {
        titles: Object.fromEntries(markets.map((m) => [m.code, "…"])),
        descriptions: Object.fromEntries(markets.map((m) => [m.code, "…"])),
      },
      null,
      2,
    ),
  ].join("\n");
}
