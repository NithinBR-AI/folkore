import { runSupervisor } from "../../src/server/agents/supervisor.js";
import type { EvalCase, EvalResult } from "../eval-runner.js";

const PERSON_ID = "frank-henderson-001";

// Phrases that signal a clinical/robotic response — any match is a fail
const FORBIDDEN = [
  "as an ai",
  "i don't have information",
  "i cannot",
  "i do not have access",
  "i'm not able",
  "no information available",
  "based on the data",
];

function forbiddenPhrase(response: string): string | null {
  const lower = response.toLowerCase();
  return FORBIDDEN.find((p) => lower.includes(p)) ?? null;
}

export const TONE_CASES: EvalCase[] = [
  {
    id: "tone-01",
    description: "Response about Marcus uses his name — feels personal not generic",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "I keep thinking about some boy — something about dinosaurs. Who is he?",
        initiatedBy: "parent",
      });
      const hit = forbiddenPhrase(response);
      const hasName = /marcus/i.test(response);
      if (hit) return { pass: false, reason: `Forbidden phrase: "${hit}"`, response };
      if (!hasName) return { pass: false, reason: "Response does not mention Marcus by name", response };
      return { pass: true, reason: "Named Marcus, no robotic phrases", response };
    },
  },
  {
    id: "tone-02",
    description: "Morning memory is warm and personal, not a data readout",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "",
        initiatedBy: "system",
      });
      const hit = forbiddenPhrase(response);
      if (hit) return { pass: false, reason: `Forbidden phrase: "${hit}"`, response };
      if (response.trim().length < 40) return { pass: false, reason: "Response too short to be warm", response };
      return { pass: true, reason: "Morning memory is substantive and clean", response };
    },
  },
  {
    id: "tone-03",
    description: "Family insight response is empathetic, not a raw stats dump",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "How has dad been doing this week?",
        initiatedBy: "family",
      });
      const hit = forbiddenPhrase(response);
      if (hit) return { pass: false, reason: `Forbidden phrase: "${hit}"`, response };
      if (response.trim().length < 60) return { pass: false, reason: "Response too short", response };
      return { pass: true, reason: "Insight response substantive, no robotic phrases", response };
    },
  },
];
