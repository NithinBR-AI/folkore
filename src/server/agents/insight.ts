import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, type AgentConfig } from "./loop.js";
import { getInsightSummary, surfaceMorningMemory } from "../db.js";

const SYSTEM_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../prompts/insight.txt"),
  "utf-8",
);

const config: AgentConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    {
      name: "get_insight_summary",
      description: "Retrieve aggregate stats for the parent: mood counts, memory counts, top tags, confusion rate. Call this first.",
      parameters: {
        type: "object",
        properties: {
          person_id: { type: "string" },
        },
        required: ["person_id"],
      },
    },
    {
      name: "surface_morning_memory",
      description: "Get the least-recently-referenced memory — useful for identifying what hasn't been talked about recently.",
      parameters: {
        type: "object",
        properties: {
          person_id: { type: "string" },
        },
        required: ["person_id"],
      },
    },
  ],
  executors: {
    get_insight_summary: async (args) => {
      const { person_id } = args as { person_id: string };
      return getInsightSummary(person_id);
    },
    surface_morning_memory: async (args) => {
      const { person_id } = args as { person_id: string };
      return surfaceMorningMemory(person_id);
    },
  },
};

export async function runInsightAgent(personId: string): Promise<string> {
  return runAgentLoop(
    `person_id: ${personId}\n\nGenerate a family insight summary for this parent.`,
    config,
  );
}
