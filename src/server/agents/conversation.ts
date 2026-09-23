import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, type AgentConfig } from "./loop.js";
import { getMemory, logInteraction } from "../db.js";

const SYSTEM_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../prompts/conversation.txt"),
  "utf-8",
);

function detectConfusion(utterance: string): {
  detected: boolean;
  type: "temporal" | "person" | "place" | null;
} {
  const lower = utterance.toLowerCase();
  if (/what (year|month|day|date|time)|what year|how long ago/i.test(lower)) {
    return { detected: true, type: "temporal" };
  }
  if (/who (is|are|was|were)|i don'?t (know|remember) (who|her|him|them)/i.test(lower)) {
    return { detected: true, type: "person" };
  }
  if (/where (am i|is this|are we)|i don'?t (know|remember) (where|this place)/i.test(lower)) {
    return { detected: true, type: "place" };
  }
  return { detected: false, type: null };
}

const agentConfig: AgentConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    {
      name: "get_memory",
      description: "Search the parent's personal memory graph for relevant memories. Use a natural language query.",
      parameters: {
        type: "object",
        properties: {
          person_id: { type: "string", description: "The parent's unique ID" },
          query:     { type: "string", description: "Natural language search, e.g. 'grandson' or 'fishing trips'" },
        },
        required: ["person_id", "query"],
      },
    },
  ],
  executors: {
    get_memory: async (args) => {
      const { person_id, query } = args as { person_id: string; query: string };
      return getMemory(person_id, undefined, undefined, query);
    },
  },
};

export async function runConversationAgent(personId: string, utterance: string): Promise<string> {
  const [response, confusion] = await Promise.all([
    runAgentLoop(`person_id: ${personId}\n\nParent said: "${utterance}"`, agentConfig),
    Promise.resolve(detectConfusion(utterance)),
  ]);

  // Logging is the system's responsibility — runs unconditionally after the agent responds
  const memories = await getMemory(personId, undefined, undefined, utterance).catch(() => []);
  const memoryIds = memories.map((m) => m.memory_id);

  logInteraction(
    personId,
    confusion.detected ? "confused" : "calm",
    confusion.detected,
    confusion.type,
    memoryIds,
    "parent",
  ).catch((err) => console.error("logInteraction failed:", err));

  return response;
}
