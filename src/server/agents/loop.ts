// Mantle uses an AWS-internal certificate not in Node's bundled store.
// Safe for internal AWS endpoints — never set this for public internet calls.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

/**
 * Core agentic tool-use loop — Mantle (OpenAI-compatible) + tool execution.
 *
 * Pattern:
 *   1. Send system prompt + messages + tool definitions to LLM
 *   2. If LLM returns tool_calls → execute each tool → append results → loop
 *   3. If LLM returns plain text → done, return it
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface ToolExecutor {
  [name: string]: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentConfig {
  systemPrompt: string;
  tools: ToolDefinition[];
  executors: ToolExecutor;
  maxIterations?: number;
}

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

const MANTLE_BASE_URL = process.env.MANTLE_BASE_URL ?? "https://bedrock-mantle.us-east-1.api.aws/v1";
const MANTLE_MODEL    = process.env.MANTLE_MODEL    ?? "deepseek.v3.2";
const MANTLE_API_KEY  = process.env.MANTLE_API_KEY  ?? "";

async function callLLM(messages: OAIMessage[], tools: ToolDefinition[]): Promise<OAIMessage> {
  const body: Record<string, unknown> = {
    model: MANTLE_MODEL,
    messages,
    temperature: 0.3,
  };

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
  }

  const res = await fetch(`${MANTLE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type":   "application/json",
      "Authorization":  `Bearer ${MANTLE_API_KEY}`,
      "openai-project": "default",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mantle HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: OAIMessage }>;
  };

  return json.choices[0].message;
}

export async function runAgentLoop(
  userMessage: string,
  config: AgentConfig,
): Promise<string> {
  const { systemPrompt, tools, executors, maxIterations = 8 } = config;

  const messages: OAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await callLLM(messages, tools);
    messages.push(response);

    // No tool calls → final answer
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return response.content ?? "";
    }

    // Execute each tool call and append results
    for (const tc of response.tool_calls) {
      const fn = tc.function.name;
      const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;

      let result: unknown;
      try {
        const executor = executors[fn];
        if (!executor) throw new Error(`Unknown tool: ${fn}`);
        result = await executor(args);
      } catch (err) {
        result = { error: (err as Error).message };
      }

      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        content:      JSON.stringify(result),
      });
    }
  }

  throw new Error("Agent exceeded max iterations without a final answer");
}
