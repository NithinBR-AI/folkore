// Hallucination guard — verify the agent only references people and places
// that exist in Frank's seeded memory store, not invented entities.

import { runSupervisor } from "../../src/server/agents/supervisor.js";
import type { EvalCase, EvalResult } from "../eval-runner.js";

const PERSON_ID = "frank-henderson-001";

// Known people and places in Frank's seed data
const KNOWN_PEOPLE = ["marcus", "sarah", "robert", "linda", "emily", "james", "mary"];
const KNOWN_PLACES = ["lake tahoe", "chicago", "new york", "oak street"];
const KNOWN_TOPICS = ["fishing", "dorothy", "big band", "sinatra", "workshop", "garage", "baseball", "teaching", "cardinals", "chess"];

// Names that should NEVER appear — if they do the agent hallucinated
const UNKNOWN_PEOPLE = ["jennifer", "michael", "david", "jessica", "karen", "tom"];

function extractMentionedUnknowns(response: string): string[] {
  const lower = response.toLowerCase();
  return UNKNOWN_PEOPLE.filter((name) => lower.includes(name));
}

function hasGroundedContent(response: string): boolean {
  const lower = response.toLowerCase();
  return (
    KNOWN_PEOPLE.some((p) => lower.includes(p)) ||
    KNOWN_PLACES.some((p) => lower.includes(p)) ||
    KNOWN_TOPICS.some((t) => lower.includes(t))
  );
}

export const HALLUCINATION_CASES: EvalCase[] = [
  {
    id: "hall-01",
    description: "Marcus response contains no invented names not in Frank's seed data",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "Who is my grandson?",
        initiatedBy: "parent",
      });
      const unknowns = extractMentionedUnknowns(response);
      if (unknowns.length > 0) {
        return { pass: false, reason: `Hallucinated people: ${unknowns.join(", ")}`, response };
      }
      return { pass: true, reason: "No hallucinated names in response", response };
    },
  },
  {
    id: "hall-02",
    description: "Family insight response references only real interaction patterns — no invented events",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "Has dad had any good days this week?",
        initiatedBy: "family",
      });
      const unknowns = extractMentionedUnknowns(response);
      if (unknowns.length > 0) {
        return { pass: false, reason: `Hallucinated names in insight: ${unknowns.join(", ")}`, response };
      }
      return { pass: true, reason: "No hallucinated names in insight response", response };
    },
  },
  {
    id: "hall-03",
    description: "Open-ended memory question response is grounded in Frank's world",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "Tell me something I love",
        initiatedBy: "parent",
      });
      const unknowns = extractMentionedUnknowns(response);
      if (unknowns.length > 0) {
        return { pass: false, reason: `Hallucinated names: ${unknowns.join(", ")}`, response };
      }
      if (!hasGroundedContent(response)) {
        return { pass: false, reason: "Response contains no grounded person or place from Frank's memory", response };
      }
      return { pass: true, reason: "Response grounded in known people/places", response };
    },
  },
];
