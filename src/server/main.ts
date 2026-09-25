import "dotenv/config";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import cors from "cors";
import type { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import { runSupervisor } from "./agents/supervisor.js";
import { getInsightSummary } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startHTTP(factory: () => McpServer): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // ── Standalone web UI ────────────────────────────────────────────
  app.get("/app", async (_req: Request, res: Response) => {
    const appHtml = __filename.endsWith(".ts")
      ? path.resolve(__dirname, "../../dist/mcp-app.html")
      : path.resolve(__dirname, "mcp-app.html");
    const html = await fs.readFile(appHtml, "utf-8");
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  // ── REST API for standalone web UI ──────────────────────────────
  app.post("/api/converse", async (req: Request, res: Response) => {
    try {
      const { person_id, utterance, initiated_by, added_by } = req.body as {
        person_id: string; utterance: string; initiated_by: string; added_by?: string;
      };
      const response = await runSupervisor({ personId: person_id, utterance, initiatedBy: initiated_by as "parent" | "family" | "system", addedBy: added_by });
      res.json({ response });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/morning", async (req: Request, res: Response) => {
    try {
      const { person_id } = req.body as { person_id: string };
      const response = await runSupervisor({ personId: person_id, utterance: "", initiatedBy: "system" });
      res.json({ response });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/insight/:person_id", async (req: Request, res: Response) => {
    try {
      const summary = await getInsightSummary(String(req.params.person_id));
      res.json(summary);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = factory();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, (err?: Error) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`Folklore MCP server → http://localhost:${port}/mcp`);
  });

  const shutdown = () => { httpServer.close(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdio(factory: () => McpServer): Promise<void> {
  await factory().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdio(createServer);
  } else {
    await startHTTP(createServer);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
