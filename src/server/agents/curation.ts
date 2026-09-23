import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, type AgentConfig } from "./loop.js";
import { addMemory } from "../db.js";

const SYSTEM_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../prompts/curation.txt"),
  "utf-8",
);

const config: AgentConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    {
      name: "add_memory",
      description: "Store a new memory about the parent into their personal memory graph. Only call this when who, what, and when are all confirmed.",
      parameters: {
        type: "object",
        properties: {
          person_id: { type: "string" },
          who:       { type: "string", description: "Person or subject of the memory, e.g. 'grandson Marcus'" },
          what:      { type: "string", description: "The memory content" },
          when:      { type: "string", description: "When it happened, freeform e.g. 'Summer 1985' or '2026'" },
          tags:      { type: "array", items: { type: "string" }, description: "e.g. ['family','fishing']" },
          added_by:  { type: "string", description: "Family member name adding this memory" },
          type:      { type: "string", enum: ["person", "place", "event", "preference", "story"] },
        },
        required: ["person_id", "who", "what", "when", "added_by", "type"],
      },
    },
  ],
  executors: {
    add_memory: async (args) => {
      const { person_id, who, what, when, tags, added_by, type } = args as {
        person_id: string; who: string; what: string; when: string;
        tags: string[]; added_by: string; type: "person" | "place" | "event" | "preference" | "story";
      };
      return addMemory(person_id, who, what, when, tags ?? [], added_by, type);
    },
  },
};

export async function runCurationAgent(personId: string, familyInput: string, addedBy: string): Promise<string> {
  return runAgentLoop(
    `person_id: ${personId}\nadded_by: ${addedBy}\n\nFamily member says: "${familyInput}"`,
    config,
  );
}
