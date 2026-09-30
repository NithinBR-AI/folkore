// Live confusion detection evals — runs detectConfusion() against real utterances
// and also verifies Conversation Agent responds appropriately when confusion fires.

import { detectConfusion } from "../../src/server/agents/conversation.js";
import { runSupervisor } from "../../src/server/agents/supervisor.js";
import type { EvalCase, EvalResult } from "../eval-runner.js";

const PERSON_ID = "frank-henderson-001";

// ── Deterministic classifier cases (no AWS needed, but run live for completeness) ──

export const CONFUSION_CASES: EvalCase[] = [
  {
    id: "conf-01",
    description: "Temporal confusion: 'what year is it' detected",
    run: async (): Promise<EvalResult> => {
      const result = detectConfusion("What year is it?");
      if (!result.detected || result.type !== "temporal") {
        return { pass: false, reason: `Expected temporal, got detected=${result.detected} type=${result.type}` };
      }
      return { pass: true, reason: "Temporal confusion detected" };
    },
  },
  {
    id: "conf-02",
    description: "Person confusion: 'who is Marcus' detected",
    run: async (): Promise<EvalResult> => {
      const result = detectConfusion("Who is Marcus?");
      if (!result.detected || result.type !== "person") {
        return { pass: false, reason: `Expected person, got detected=${result.detected} type=${result.type}` };
      }
      return { pass: true, reason: "Person confusion detected" };
    },
  },
  {
    id: "conf-03",
    description: "Place confusion: 'where am I' detected",
    run: async (): Promise<EvalResult> => {
      const result = detectConfusion("Where am I?");
      if (!result.detected || result.type !== "place") {
        return { pass: false, reason: `Expected place, got detected=${result.detected} type=${result.type}` };
      }
      return { pass: true, reason: "Place confusion detected" };
    },
  },
  {
    id: "conf-04",
    description: "Safe utterance: 'tell me about Marcus' not flagged as confusion",
    run: async (): Promise<EvalResult> => {
      const result = detectConfusion("Tell me about Marcus");
      if (result.detected) {
        return { pass: false, reason: `False positive — detected=${result.detected} type=${result.type}` };
      }
      return { pass: true, reason: "Safe utterance correctly not flagged" };
    },
  },
  {
    id: "conf-05",
    description: "Safe utterance: 'I remember fishing at the lake' not flagged",
    run: async (): Promise<EvalResult> => {
      const result = detectConfusion("I remember fishing at the lake with my son");
      if (result.detected) {
        return { pass: false, reason: `False positive — type=${result.type}` };
      }
      return { pass: true, reason: "Memory recall not flagged as confusion" };
    },
  },
  {
    id: "conf-06",
    description: "Person confusion utterance routed to agent — response contains a name from Frank's world",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "I don't know who this woman is who keeps calling me",
        initiatedBy: "parent",
      });
      // Agent should ground the response in a real person from Frank's memory
      const hasKnownPerson = /sarah|robert|linda|marcus/i.test(response);
      if (!hasKnownPerson) {
        return { pass: false, reason: "Confusion response doesn't reference any known person", response };
      }
      return { pass: true, reason: "Confusion response grounded in Frank's memory", response };
    },
  },
];
