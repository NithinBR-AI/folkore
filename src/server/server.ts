import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runSupervisor } from "./agents/supervisor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = __filename.endsWith(".ts")
  ? path.join(__dirname, "dist")
  : __dirname;

const RESOURCE_URI = "ui://folkore/mcp-app.html";

export function createServer(): McpServer {
  const server = new McpServer({ name: "Folkore Memory Companion", version: "1.0.0" });

  // ── converse ──────────────────────────────────────────────────────────────
  // Primary entry point — supervisor routes to the right agent automatically.
  registerAppTool(
    server,
    "converse",
    {
      title: "Converse with Folkore",
      description: "Send any message to Folkore. If the parent is speaking, the Conversation Agent responds. If family is adding a memory, the Curation Agent handles it. If asking for a summary, the Insight Agent responds.",
      inputSchema: z.object({
        person_id:    z.string().describe("Parent's unique ID"),
        utterance:    z.string().describe("What was said"),
        initiated_by: z.enum(["parent", "family", "system"]).default("parent"),
        added_by:     z.string().optional().describe("Family member name — required when initiated_by is 'family'"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const response = await runSupervisor({
        personId:    args.person_id,
        utterance:   args.utterance,
        initiatedBy: args.initiated_by,
        addedBy:     args.added_by,
      });
      return {
        content: [{ type: "text", text: response }],
        _meta: { folkore: { action: "converse", response } },
      };
    },
  );

  // ── morning_memory ────────────────────────────────────────────────────────
  // Proactive trigger — called by EventBridge each morning.
  registerAppTool(
    server,
    "morning_memory",
    {
      title: "Morning Memory",
      description: "Proactive morning trigger — surfaces the least-recently-referenced memory for the parent.",
      inputSchema: z.object({
        person_id: z.string().describe("Parent's unique ID"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const response = await runSupervisor({
        personId:    args.person_id,
        utterance:   "",
        initiatedBy: "system",
      });
      return {
        content: [{ type: "text", text: response }],
        _meta: { folkore: { action: "morning_memory", response } },
      };
    },
  );

  // ── UI resource ───────────────────────────────────────────────────────────
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
