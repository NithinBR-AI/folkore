import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  addMemory,
  getMemory,
  logInteraction,
  getInsightSummary,
  surfaceMorningMemory,
} from "./db.js";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// All 5 tools share a single UI resource — the React app routes views internally.
const RESOURCE_URI = "ui://folkore/mcp-app.html";

export function createServer(): McpServer {
  const server = new McpServer({ name: "Folklore Memory Companion", version: "1.0.0" });

  // ── add_memory ────────────────────────────────────────────────────────────
  registerAppTool(
    server,
    "add_memory",
    {
      title: "Add Memory",
      description: "Store a new memory about the parent (event, person, place, or feeling).",
      inputSchema: z.object({
        who: z.string().describe("Person associated with the memory (e.g. 'Mom')"),
        what: z.string().describe("Description of the memory"),
        when: z.string().describe("When it happened (freeform, e.g. 'Summer 1985')"),
        tags: z.array(z.string()).default([]).describe("Optional tags, e.g. ['childhood', 'vacation']"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const m = addMemory(args.who, args.what, args.when, args.tags);
      return {
        content: [{ type: "text", text: `Memory saved: ${m.id}` }],
        _meta: { folkore: { action: "add_memory", memory: m } },
      };
    },
  );

  // ── get_memory ────────────────────────────────────────────────────────────
  registerAppTool(
    server,
    "get_memory",
    {
      title: "Get Memory",
      description: "Retrieve memories, optionally filtered by ID or tag.",
      inputSchema: z.object({
        id: z.string().optional().describe("Specific memory ID"),
        tag: z.string().optional().describe("Filter by tag"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const results = getMemory(args.id, args.tag);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        _meta: { folkore: { action: "get_memory", memories: results } },
      };
    },
  );

  // ── log_interaction ───────────────────────────────────────────────────────
  registerAppTool(
    server,
    "log_interaction",
    {
      title: "Log Interaction",
      description: "Record an Alexa conversation session — transcript and mood.",
      inputSchema: z.object({
        transcript: z.string().describe("What was said during the session"),
        mood: z.enum(["happy", "calm", "confused", "sad", "anxious"]).describe("Parent's apparent mood"),
        memoryId: z.string().nullable().default(null).describe("Related memory ID, if any"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const i = logInteraction(args.transcript, args.mood, args.memoryId);
      return {
        content: [{ type: "text", text: `Interaction logged: ${i.id}` }],
        _meta: { folkore: { action: "log_interaction", interaction: i } },
      };
    },
  );

  // ── get_insight_summary ───────────────────────────────────────────────────
  registerAppTool(
    server,
    "get_insight_summary",
    {
      title: "Insight Summary",
      description: "Return aggregate stats: mood trends, memory counts, top tags.",
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (): Promise<CallToolResult> => {
      const summary = getInsightSummary();
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        _meta: { folkore: { action: "get_insight_summary", summary } },
      };
    },
  );

  // ── surface_morning_memory ────────────────────────────────────────────────
  registerAppTool(
    server,
    "surface_morning_memory",
    {
      title: "Morning Memory",
      description: "Surface today's memory prompt — rotates daily for the parent's morning routine.",
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (): Promise<CallToolResult> => {
      const m = surfaceMorningMemory();
      if (!m) {
        return {
          content: [{ type: "text", text: "No memories stored yet. Add some first!" }],
          _meta: { folkore: { action: "surface_morning_memory", memory: null } },
        };
      }
      return {
        content: [{ type: "text", text: `Today's memory: ${m.what} (${m.when})` }],
        _meta: { folkore: { action: "surface_morning_memory", memory: m } },
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
