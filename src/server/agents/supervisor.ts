import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runConversationAgent } from "./conversation.js";
import { runCurationAgent }     from "./curation.js";
import { runInsightAgent }      from "./insight.js";
import { surfaceMorningMemory } from "../db.js";
import { runAgentLoop, type AgentConfig } from "./loop.js";

type Intent = "parent" | "family" | "insight" | "morning";

const CLASSIFY_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../prompts/supervisor-classify.txt"),
  "utf-8",
);

const classifyConfig: AgentConfig = {
  systemPrompt: CLASSIFY_PROMPT,
  tools: [],
  executors: {},
  maxIterations: 1,
};

async function classifyIntent(request: string): Promise<Intent> {
  const result = await runAgentLoop(request, classifyConfig);
  const intent = result.trim().toLowerCase() as Intent;
  if (["parent", "family", "insight", "morning"].includes(intent)) return intent;
  return "parent";
}

export interface SupervisorRequest {
  personId:    string;
  utterance:   string;
  initiatedBy: "parent" | "family" | "system";
  addedBy?:    string;
}

export async function runSupervisor(req: SupervisorRequest): Promise<string> {
  const { personId, utterance, initiatedBy, addedBy } = req;

  if (initiatedBy === "system") {
    const memory = await surfaceMorningMemory(personId);
    if (!memory) return "No memories stored yet for this parent.";
    return `Good morning! ${memory.what} — ${memory.when}.`;
  }

  const intent = await classifyIntent(
    `initiatedBy: ${initiatedBy}\nmessage: "${utterance}"`,
  );

  switch (intent) {
    case "family":
      return runCurationAgent(personId, utterance, addedBy ?? "family");
    case "insight":
      return runInsightAgent(personId);
    case "morning": {
      const memory = await surfaceMorningMemory(personId);
      return memory ? `Good morning! ${memory.what} — ${memory.when}.` : "No memories yet.";
    }
    case "parent":
    default:
      return runConversationAgent(personId, utterance);
  }
}
