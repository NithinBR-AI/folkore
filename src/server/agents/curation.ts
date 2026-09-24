import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, type AgentConfig } from "./loop.js";
import { addMemory, addNode, addEdge } from "../db.js";

const SYSTEM_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../prompts/curation.txt"),
  "utf-8",
);

const config: AgentConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    {
      name: "add_memory",
      description: "Store a new memory about the parent. Only call this when who, what, and when are all confirmed.",
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
    {
      name: "add_node",
      description: "Register a named entity (person, place, event) in the memory graph. Call this when a relationship is being described — e.g. 'Marcus is Frank's grandson' creates a node for Marcus.",
      parameters: {
        type: "object",
        properties: {
          person_id:  { type: "string" },
          type:       { type: "string", enum: ["person", "place", "event"] },
          name:       { type: "string", description: "The entity's name, e.g. 'Marcus', 'Lake Tahoe'" },
          attributes: { type: "object", description: "Optional extra facts, e.g. { age: 8, role: 'grandson' }" },
        },
        required: ["person_id", "type", "name"],
      },
    },
    {
      name: "add_edge",
      description: "Create a typed relationship between two entities or between an entity and a memory. Use after add_node. e.g. Marcus (node_id) → grandson_of → Frank's person_id.",
      parameters: {
        type: "object",
        properties: {
          person_id:    { type: "string" },
          from_id:      { type: "string", description: "node_id or memory_id of the source" },
          to_id:        { type: "string", description: "node_id or memory_id of the target" },
          relationship: { type: "string", description: "e.g. 'grandson_of', 'spouse_of', 'attended', 'lives_at', 'loves'" },
        },
        required: ["person_id", "from_id", "to_id", "relationship"],
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
    add_node: async (args) => {
      const { person_id, type, name, attributes } = args as {
        person_id: string; type: "person" | "place" | "event"; name: string; attributes?: Record<string, unknown>;
      };
      return addNode(person_id, type, name, attributes ?? {});
    },
    add_edge: async (args) => {
      const { person_id, from_id, to_id, relationship } = args as {
        person_id: string; from_id: string; to_id: string; relationship: string;
      };
      return addEdge(person_id, from_id, to_id, relationship);
    },
  },
};

export async function runCurationAgent(personId: string, familyInput: string, addedBy: string): Promise<string> {
  return runAgentLoop(
    `person_id: ${personId}\nadded_by: ${addedBy}\n\nFamily member says: "${familyInput}"`,
    config,
  );
}
