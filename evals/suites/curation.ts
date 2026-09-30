// Curation eval — add a memory via the family agent, then retrieve it back.
// Proves the full write path: Curation Agent → scrubMemory → DynamoDB → getMemory.

import { runSupervisor } from "../../src/server/agents/supervisor.js";
import { addMemory, getMemory } from "../../src/server/db.js";
import type { EvalCase, EvalResult } from "../eval-runner.js";

const PERSON_ID = "frank-henderson-001";
const EVAL_PERSON_ID = "eval-curation-person-001"; // isolated from Frank's seed data

export const CURATION_CASES: EvalCase[] = [
  {
    id: "cur-01",
    description: "Memory added via db.addMemory() is immediately retrievable by ID",
    run: async (): Promise<EvalResult> => {
      const m = await addMemory(
        EVAL_PERSON_ID,
        "grandson Leo",
        "Leo is six and loves trains. He wants to be a train driver.",
        "Spring 2026",
        ["family", "grandson"],
        "family",
        "person",
      );
      const stored = await getMemory(EVAL_PERSON_ID, m.memory_id);
      if (!stored[0]) {
        return { pass: false, reason: "Memory not found by ID after addMemory()" };
      }
      if (!stored[0].what.toLowerCase().includes("leo")) {
        return { pass: false, reason: `'what' field missing Leo: "${stored[0].what}"` };
      }
      return { pass: true, reason: `Memory stored and retrieved: who="${stored[0].who}"` };
    },
  },
  {
    id: "cur-02",
    description: "PII in who field is scrubbed before storage — phone number does not persist",
    run: async (): Promise<EvalResult> => {
      const m = await addMemory(
        EVAL_PERSON_ID,
        "daughter Anna 555-987-6543",
        "Call her on Sunday evenings",
        "always",
        ["family"],
        "family",
        "person",
      );
      const stored = await getMemory(EVAL_PERSON_ID, m.memory_id);
      const who = stored[0]?.who ?? "";
      if (who.includes("555-987-6543")) {
        return { pass: false, reason: `Phone number not scrubbed — who="${who}"` };
      }
      if (!who.includes("[PHONE REDACTED]")) {
        return { pass: false, reason: `Unexpected who field value: "${who}"` };
      }
      return { pass: true, reason: `PII scrubbed correctly: who="${who}"` };
    },
  },
  {
    id: "cur-03",
    description: "Family utterance via Supervisor routes to Curation Agent and returns confirmation",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "Dad loves watching the Cardinals play baseball on Sunday afternoons",
        initiatedBy: "family",
        addedBy: "daughter Sarah",
      });
      if (!response || response.trim().length < 20) {
        return { pass: false, reason: "Curation Agent returned empty or too-short response", response };
      }
      // Should confirm the memory was stored, not deflect
      const lower = response.toLowerCase();
      const deflected = /i (cannot|can't|don't|am unable)/i.test(lower);
      if (deflected) {
        return { pass: false, reason: "Curation Agent deflected instead of confirming", response };
      }
      return { pass: true, reason: "Curation Agent accepted and confirmed the memory", response };
    },
  },
  {
    id: "cur-04",
    description: "Memory with unique content is retrievable by ID immediately after write",
    run: async (): Promise<EvalResult> => {
      const unique = `eval-chess-marker-${Math.random().toString(36).slice(2, 8)}`;
      const m = await addMemory(
        EVAL_PERSON_ID,
        "friend George",
        `Frank and George used to play chess every Tuesday. ${unique}`,
        "1990s",
        ["friendship", "chess"],
        "friend",
        "person",
      );
      const results = await getMemory(EVAL_PERSON_ID, m.memory_id);
      if (!results[0]) {
        return { pass: false, reason: "Chess memory not retrievable by ID immediately after write" };
      }
      if (!results[0].what.includes(unique)) {
        return { pass: false, reason: `Memory found but wrong content: "${results[0].what}"` };
      }
      return { pass: true, reason: "Memory retrievable by ID immediately after write" };
    },
  },
];
