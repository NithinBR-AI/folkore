import type { Memory } from "./db.js";

const MANTLE_BASE_URL = process.env.MANTLE_BASE_URL ?? "https://bedrock-mantle.intuit.com/openai/v1";
const MANTLE_MODEL    = process.env.MANTLE_MODEL    ?? "gpt-oss-deepseek-r1-0528";
const MANTLE_API_KEY  = process.env.MANTLE_API_KEY  ?? "";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${MANTLE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${MANTLE_API_KEY}`,
    },
    body: JSON.stringify({ model: MANTLE_MODEL, messages, temperature: 0.7 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mantel LLM error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return json.choices[0]?.message?.content?.trim() ?? "";
}

// ── Conversation Agent ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Folkore, a warm and gentle memory companion for aging parents.
Your job is to help the parent remember people and moments from their life — the way a loving
family member would. Keep responses short (2-4 sentences), warm, and conversational.
Never clinical. Never list facts. Always speak as if you're reminiscing together.
If you don't know something, gently say so and invite them to share more.`;

export async function generateAlexaResponse(
  parentQuery: string,
  memories: Memory[],
): Promise<string> {
  const memoryContext = memories.length > 0
    ? memories.map((m) => `- ${m.who}: ${m.what} (${m.when})`).join("\n")
    : "No specific memories found for this topic.";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `The parent just said: "${parentQuery}"\n\nRelevant memories from their family:\n${memoryContext}\n\nRespond warmly as their memory companion.`,
    },
  ];

  return chatCompletion(messages);
}

// ── Insight Agent ─────────────────────────────────────────────────────────────

export async function generateInsightNarrative(
  totalMemories: number,
  totalInteractions: number,
  moodCounts: Record<string, number>,
  topTags: Record<string, number>,
  confusionRate: number,
): Promise<string> {
  const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  const topTagsList = Object.entries(topTags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t)
    .join(", ");

  const messages: ChatMessage[] = [
    { role: "system", content: "You are a compassionate care insight assistant. Write a 2-3 sentence narrative summary for a family caregiver, not clinical stats." },
    {
      role: "user",
      content: `Memory stats:\n- Total memories: ${totalMemories}\n- Interactions: ${totalInteractions}\n- Most common mood: ${topMood}\n- Top memory topics: ${topTagsList}\n- Confusion rate: ${confusionRate}%\n\nWrite a warm weekly summary for the family.`,
    },
  ];

  return chatCompletion(messages);
}
