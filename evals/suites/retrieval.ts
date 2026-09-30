import { runSupervisor } from "../../src/server/agents/supervisor.js";
import type { EvalCase, EvalResult } from "../eval-runner.js";

const PERSON_ID = "frank-henderson-001";

export const RETRIEVAL_CASES: EvalCase[] = [
  {
    id: "ret-01",
    description: "Asking about Marcus returns his age or dinosaur/palaeontologist fact",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "Tell me about my grandson",
        initiatedBy: "parent",
      });
      const lower = response.toLowerCase();
      const hasFact =
        /marcus/i.test(response) &&
        (/eight|8/.test(lower) || /dinosaur|palaeontologist|paleontologist/.test(lower));
      if (!hasFact) {
        return { pass: false, reason: "Response missing seeded facts about Marcus (age, dinosaurs, palaeontologist)", response };
      }
      return { pass: true, reason: "Marcus facts present in response", response };
    },
  },
  {
    id: "ret-02",
    description: "Asking about Lake Tahoe returns fishing or family tradition fact",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "I keep thinking about a lake we used to go to. Was it something about fishing?",
        initiatedBy: "parent",
      });
      const lower = response.toLowerCase();
      const hasFact = /tahoe/i.test(lower) || /fishing/i.test(lower) || /july/i.test(lower);
      if (!hasFact) {
        return { pass: false, reason: "Response missing Lake Tahoe / fishing facts", response };
      }
      return { pass: true, reason: "Lake Tahoe/fishing retrieval correct", response };
    },
  },
  {
    id: "ret-03",
    description: "Asking about apple pie returns Sarah / Sunday baking fact",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "Someone used to bake for me — apple pie I think. Who was it?",
        initiatedBy: "parent",
      });
      const lower = response.toLowerCase();
      const hasFact = /sarah/i.test(lower) || /apple pie/i.test(lower) || /sunday/i.test(lower);
      if (!hasFact) {
        return { pass: false, reason: "Response missing Sarah / apple pie / Sunday fact", response };
      }
      return { pass: true, reason: "Apple pie memory retrieved correctly", response };
    },
  },
  {
    id: "ret-04",
    description: "Confusion utterance about a person triggers memory retrieval, not a generic reply",
    run: async (): Promise<EvalResult> => {
      const response = await runSupervisor({
        personId: PERSON_ID,
        utterance: "Who is Sarah?",
        initiatedBy: "parent",
      });
      const lower = response.toLowerCase();
      const hasContext = /daughter|coffee|sunday|visit/i.test(lower);
      if (!hasContext) {
        return { pass: false, reason: "Response about Sarah lacks seeded context (daughter, coffee, Sunday)", response };
      }
      return { pass: true, reason: "Sarah context correctly retrieved", response };
    },
  },
];
