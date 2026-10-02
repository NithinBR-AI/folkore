import "dotenv/config";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { createServer } from "./server.js";
import { runSupervisor } from "./agents/supervisor.js";
import { getInsightSummary, generateWeeklyDigest } from "./db.js";
import { rateLimitConverse } from "./guardrails/index.js";

const __dirname = process.env.LAMBDA_TASK_ROOT ?? path.dirname(fileURLToPath(import.meta.url));

const app = createMcpExpressApp({ host: "0.0.0.0" });
app.use(cors());

app.get("/app", async (_req: Request, res: Response) => {
  const html = await fs.readFile(path.resolve(__dirname, "mcp-app.html"), "utf-8");
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

app.post("/api/converse", rateLimitConverse, async (req: Request, res: Response) => {
  try {
    const { person_id, utterance, initiated_by, added_by, history } = req.body as {
      person_id: string; utterance: string; initiated_by: string; added_by?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };
    const response = await runSupervisor({ personId: person_id, utterance, initiatedBy: initiated_by as "parent" | "family" | "system", addedBy: added_by, history });
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

app.get("/api/digest/:person_id", async (req: Request, res: Response) => {
  try {
    const digest = await generateWeeklyDigest(String(req.params.person_id));
    res.json(digest);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.all("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Lambda Function URL handler — pipes event directly into Express via a local HTTP server
// This avoids @vendia/serverless-express which only supports API Gateway proxy format.
let _server: http.Server | null = null;
let _port = 0;

async function getServer(): Promise<number> {
  if (_server && _port) return _port;
  return new Promise((resolve, reject) => {
    _server = http.createServer(app);
    _server.listen(0, "127.0.0.1", () => {
      const addr = _server!.address() as { port: number };
      _port = addr.port;
      resolve(_port);
    });
    _server.on("error", reject);
  });
}

interface FunctionUrlEvent {
  requestContext: { http: { method: string; path: string } };
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

export const handler = async (event: FunctionUrlEvent) => {
  const port = await getServer();
  const { method, path: urlPath } = event.requestContext.http;

  const qs = event.queryStringParameters
    ? "?" + new URLSearchParams(event.queryStringParameters).toString()
    : "";

  const bodyBuffer = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf-8")
    : null;

  return new Promise<{ statusCode: number; headers: Record<string, string>; body: string; isBase64Encoded: boolean }>((resolve, reject) => {
    const reqOpts: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      method,
      path: urlPath + qs,
      headers: {
        ...(event.headers ?? {}),
        ...(bodyBuffer ? { "content-length": String(bodyBuffer.length) } : {}),
      },
    };

    const req = http.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const headers: Record<string, string> = {};
        const skip = new Set(["content-length", "transfer-encoding", "connection", "keep-alive"]);
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined && !skip.has(k.toLowerCase()))
            headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }
        resolve({
          statusCode: res.statusCode ?? 200,
          headers,
          body: raw.toString("base64"),
          isBase64Encoded: true,
        });
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
};
