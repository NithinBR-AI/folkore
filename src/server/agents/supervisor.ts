import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runConversationAgent } from "./conversation.js";
import { runCurationAgent }     from "./curation.js";
import { runInsightAgent }      from "./insight.js";
import { surfaceMorningMemory } from "../db.js";
import { runAgentLoop, type AgentConfig, type HistoryMessage } from "./loop.js";

type Intent = "parent" | "family" | "insight" | "morning";

const PROMPTS_DIR = process.env.LAMBDA_TASK_ROOT
  ? join(process.env.LAMBDA_TASK_ROOT, "prompts")
  : join(dirname(fileURLToPath(import.meta.url)), "../prompts");
const CLASSIFY_PROMPT = readFileSync(join(PROMPTS_DIR, "supervisor-classify.txt"), "utf-8");

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
  history?:    HistoryMessage[];
}

export async function runSupervisor(req: SupervisorRequest): Promise<string> {
  const { personId, utterance, initiatedBy, addedBy, history = [] } = req;

  if (initiatedBy === "system") {
    const memory = await surfaceMorningMemory(personId);
    if (!memory) return "Good morning! It's a lovely day. How are you feeling?";
    return runConversationAgent(
      personId,
      `[MORNING GREETING] Start with "Good morning!" then weave in this memory warmly and naturally in 1–2 sentences — do not recite it as a fact, do not include dates or year ranges: ${memory.what}`,
    );
  }

  const intent = await classifyIntent(
    `initiatedBy: ${initiatedBy}\nmessage: "${utterance}"`,
  );

  switch (intent) {
    case "family":
      return runCurationAgent(personId, utterance, addedBy ?? "family", history);
    case "insight":
      return runInsightAgent(personId);
    case "morning": {
      const memory = await surfaceMorningMemory(personId);
      if (!memory) return "Good morning! It's a lovely day. How are you feeling?";
      return runConversationAgent(
        personId,
        `[MORNING GREETING] Start with "Good morning!" then weave in this memory warmly and naturally in 1–2 sentences — do not recite it as a fact, do not include dates or year ranges: ${memory.what}`,
      );
    }
    case "parent":
    default:
      return runConversationAgent(personId, utterance, history);
  }
}
