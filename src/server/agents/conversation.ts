import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, type AgentConfig } from "./loop.js";
import { getMemory, logInteraction } from "../db.js";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const SECRETS_CLIENT = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const MANTLE_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:156187162502:secret:folkore/mantle-api-key-1eCRwf";
let _mantleApiKey: string | null = null;
async function getApiKey(): Promise<string> {
  if (_mantleApiKey) return _mantleApiKey;
  if (process.env.MANTLE_API_KEY) { _mantleApiKey = process.env.MANTLE_API_KEY; return _mantleApiKey; }
  const res = await SECRETS_CLIENT.send(new GetSecretValueCommand({ SecretId: MANTLE_SECRET_ARN }));
  const secret = JSON.parse(res.SecretString ?? "{}") as Record<string, string>;
  _mantleApiKey = secret.MANTLE_API_KEY ?? "";
  return _mantleApiKey;
}

const MANTLE_BASE_URL  = process.env.MANTLE_BASE_URL ?? "https://bedrock-mantle.us-east-1.api.aws/v1";
const MANTLE_MODEL     = process.env.MANTLE_MODEL    ?? "deepseek.v3.2";

const PROMPTS_DIR      = process.env.LAMBDA_TASK_ROOT
  ? join(process.env.LAMBDA_TASK_ROOT, "prompts")
  : join(dirname(fileURLToPath(import.meta.url)), "../prompts");
const SYSTEM_PROMPT    = readFileSync(join(PROMPTS_DIR, "conversation.txt"), "utf-8");
const CONFUSION_SYSTEM = readFileSync(join(PROMPTS_DIR, "confusion-detect.txt"), "utf-8");

export type ConfusionResult = {
  detected: boolean;
  type: "temporal" | "person" | "place" | null;
};

export async function detectConfusion(utterance: string): Promise<ConfusionResult> {
  try {
    const apiKey = await getApiKey();
    const res = await fetch(`${MANTLE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Authorization":  `Bearer ${apiKey}`,
        "openai-project": "default",
      },
      body: JSON.stringify({
        model: MANTLE_MODEL,
        messages: [
          { role: "system", content: CONFUSION_SYSTEM },
          { role: "user",   content: `Patient said: "${utterance}"` },
        ],
        temperature: 0,
        max_tokens: 50,
      }),
    });
    if (!res.ok) throw new Error(`Mantle ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const parsed = JSON.parse(json.choices[0].message.content.trim()) as { confused: boolean; type: string };
    const typeMap: Record<string, ConfusionResult["type"]> = {
      temporal: "temporal", person: "person", place: "place", none: null,
    };
    return { detected: parsed.confused, type: typeMap[parsed.type] ?? null };
  } catch {
    return { detected: false, type: null };
  }
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

export async function runConversationAgent(personId: string, utterance: string, history: import("./loop.js").HistoryMessage[] = []): Promise<{ response: string; confusion: boolean }> {
  const [response, confusion] = await Promise.all([
    runAgentLoop(`person_id: ${personId}\n\nParent said: "${utterance}"`, agentConfig, history),
    detectConfusion(utterance),
  ]);
  console.log(`[confusion] detected=${confusion.detected} type=${confusion.type} utterance="${utterance}"`);

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

  return { response, confusion: confusion.detected };
}
