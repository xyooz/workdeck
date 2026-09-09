import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WorkDeckService } from "@workdeck/api";
import { WorkDeckDatabase } from "@workdeck/db";
import { createWorkDeckMcpServer } from "./tools.js";

type McpSession = {
  server: ReturnType<typeof createWorkDeckMcpServer>;
  transport: StreamableHTTPServerTransport;
};

export type McpAppOptions = {
  component?: string;
};

const fallbackComponent = `
const root = document.getElementById("root");
if (root) root.textContent = "WorkDeck UI bundle is not built yet.";
`.trim();

export function loadComponentBundle(bundlePath = process.env.WORKDECK_CHATGPT_UI_BUNDLE ?? join(process.cwd(), "apps", "chatgpt-ui", "dist", "component.js")) {
  if (!existsSync(bundlePath)) return fallbackComponent;
  return readFileSync(bundlePath, "utf8");
}

export function createMcpApp(service: WorkDeckService, options: McpAppOptions = {}) {
  const component = options.component ?? loadComponentBundle();
  const sessions = new Map<string, McpSession>();
  const app = express();

  app.use(cors({ origin: true, exposedHeaders: ["Mcp-Session-Id"] }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "workdeck-mcp" });
  });

  app.all("/mcp", async (request: Request, response: Response) => {
    const requestedSessionId = request.header("mcp-session-id");
    let session = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

    if (requestedSessionId && !session) {
      response.status(404).json({ error: "MCP session was not found" });
      return;
    }

    if (!session && request.method !== "POST") {
      response.status(400).json({ error: "MCP initialization must use POST" });
      return;
    }

    if (!session) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          if (session) sessions.set(sessionId, session);
        },
      });
      const server = createWorkDeckMcpServer(service, component);
      session = { server, transport };
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
        void server.close();
      };
      await server.connect(transport);
    }

    try {
      await session.transport.handleRequest(request, response, request.body);
      if (request.method === "DELETE" && session.transport.sessionId) sessions.delete(session.transport.sessionId);
    } catch (error) {
      if (!response.headersSent) {
        const message = error instanceof Error ? error.message : "MCP request failed";
        response.status(500).json({ error: message });
      }
    }
  });

  app.use((_request, response) => response.status(404).json({ error: "Route not found" }));
  return app;
}

export function startMcpServer() {
  const port = Number(process.env.MCP_PORT ?? 4200);
  const database = new WorkDeckDatabase();
  database.seedDemo();
  const service = new WorkDeckService(database);
  const app = createMcpApp(service);
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`WorkDeck MCP listening on http://127.0.0.1:${port}/mcp`);
    console.log(`DB: ${database.filePath}`);
  });

  const shutdown = () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

const entrypoint = process.argv[1]?.replaceAll("\\", "/");
if (entrypoint?.endsWith("/apps/mcp/src/server.ts")) {
  startMcpServer();
}
