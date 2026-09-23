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

const RESOURCE_URI = "ui://folkore/mcp-app.html";

export function createServer(): McpServer {
  const server = new McpServer({ name: "Folkore Memory Companion", version: "1.0.0" });

  // ── add_memory ────────────────────────────────────────────────────────────
  registerAppTool(
    server,
    "add_memory",
    {
      title: "Add Memory",
      description: "Store a new memory about the parent (event, person, place, or feeling).",
      inputSchema: z.object({
        person_id: z.string().describe("Parent's unique ID"),
        who:       z.string().describe("Person associated with the memory (e.g. 'grandson Marcus')"),
        what:      z.string().describe("Description of the memory"),
        when:      z.string().describe("When it happened (freeform, e.g. 'Summer 1985')"),
        tags:      z.array(z.string()).default([]).describe("Optional tags, e.g. ['family', 'fishing']"),
        added_by:  z.string().default("family").describe("Who is adding this memory"),
        type:      z.enum(["person", "place", "event", "preference", "story"]).default("story"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const m = await addMemory(args.person_id, args.who, args.what, args.when, args.tags, args.added_by, args.type);
      return {
        content: [{ type: "text", text: `Memory saved: ${m.memory_id}` }],
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
      description: "Retrieve memories for a parent, optionally filtered by ID or tag.",
      inputSchema: z.object({
        person_id: z.string().describe("Parent's unique ID"),
        memory_id: z.string().optional().describe("Specific memory ID"),
        tag:       z.string().optional().describe("Filter by tag"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const results = await getMemory(args.person_id, args.memory_id, args.tag);
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
      description: "Record an Alexa conversation session — mood and confusion signals.",
      inputSchema: z.object({
        person_id:           z.string().describe("Parent's unique ID"),
        mood:                z.enum(["happy", "calm", "confused", "sad", "anxious"]),
        confusion_detected:  z.boolean().default(false),
        confusion_type:      z.enum(["temporal", "person", "place"]).nullable().default(null),
        memories_referenced: z.array(z.string()).default([]).describe("memory_ids surfaced in this session"),
        initiated_by:        z.enum(["parent", "alexa"]).default("parent"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const i = await logInteraction(
        args.person_id,
        args.mood,
        args.confusion_detected,
        args.confusion_type,
        args.memories_referenced,
        args.initiated_by,
      );
      return {
        content: [{ type: "text", text: `Interaction logged: ${i.session_id}` }],
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
      description: "Return aggregate stats: mood trends, memory counts, top tags, confusion rate.",
      inputSchema: z.object({
        person_id: z.string().describe("Parent's unique ID"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const summary = await getInsightSummary(args.person_id);
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
      description: "Surface today's memory prompt — least-recently-referenced memory for the parent's morning routine.",
      inputSchema: z.object({
        person_id: z.string().describe("Parent's unique ID"),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args): Promise<CallToolResult> => {
      const m = await surfaceMorningMemory(args.person_id);
      if (!m) {
        return {
          content: [{ type: "text", text: "No memories stored yet. Add some first!" }],
          _meta: { folkore: { action: "surface_morning_memory", memory: null } },
        };
      }
      return {
        content: [{ type: "text", text: `Good morning! ${m.what} (${m.when})` }],
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
