import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApp, WorkDeckService } from "@workdeck/api";
import { WorkDeckDatabase } from "@workdeck/db";
import { McpAppsBridge } from "../apps/chatgpt-ui/src/bridge.js";
import { createMcpApp, isAllowedMcpOrigin } from "../apps/mcp/src/server.js";
import { createWorkDeckMcpServer, UI_RESOURCE_URIS } from "../apps/mcp/src/tools.js";

async function withMcp(run: (service: WorkDeckService, database: WorkDeckDatabase, client: Client) => Promise<void>) {
  const database = new WorkDeckDatabase(":memory:");
  const service = new WorkDeckService(database);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWorkDeckMcpServer(service, "<script>window.__WORKDECK_TEST__=true;</script>");
  const client = new Client({ name: "workdeck-test-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(service, database, client);
  } finally {
    await client.close();
    await server.close();
    database.close();
  }
}

function structured(result: unknown) {
  return ((result && typeof result === "object" && "structuredContent" in result ? (result as { structuredContent?: unknown }).structuredContent : undefined) ?? {}) as Record<string, any>;
}

async function startHttpApp(app: ReturnType<typeof createApp>) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server did not expose a TCP address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function stopHttpApp(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function httpHealth(url: string, headers: Record<string, string> = {}) {
  const target = new URL(`${url}/health`);
  return new Promise<{ statusCode: number; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        headers,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers }));
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function runConcurrentSqliteWorker(filePath: string, projectId: string, workerId: string, count: number) {
  const workerPath = fileURLToPath(new URL("./sqlite-concurrent-worker.ts", import.meta.url));
  const tsxPath = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
  const worker = spawn(process.execPath, [tsxPath, workerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKDECK_CONCURRENT_DB_PATH: filePath,
      WORKDECK_CONCURRENT_PROJECT_ID: projectId,
      WORKDECK_CONCURRENT_WORKER_ID: workerId,
      WORKDECK_CONCURRENT_COUNT: String(count),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  return new Promise<void>((resolve, reject) => {
    let errorOutput = "";
    worker.stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    worker.once("error", reject);
    worker.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`SQLite worker failed (${signal ?? `code ${code}`}): ${errorOutput.trim()}`));
    });
  });
}

describe("WorkDeck Phase 0.2 MCP contracts", () => {
  it("uses the standard MCP Apps bridge before ChatGPT compatibility methods", async () => {
    const sent: Array<Record<string, any>> = [];
    let listener: ((event: MessageEvent) => void) | undefined;
    const parentWindow = {
      postMessage(message: unknown) {
        const packet = message as Record<string, any>;
        sent.push(packet);
        if (packet.method === "ui/initialize") {
          queueMicrotask(() => listener?.({ source: parentWindow, data: { jsonrpc: "2.0", id: packet.id, result: { hostInfo: { name: "test-host" } } } } as MessageEvent));
        }
        if (packet.method === "tools/call") {
          queueMicrotask(() => listener?.({ source: parentWindow, data: { jsonrpc: "2.0", id: packet.id, result: { structuredContent: { ok: true } } } } as MessageEvent));
        }
        if (packet.method === "ui/message") {
          queueMicrotask(() => listener?.({ source: parentWindow, data: { jsonrpc: "2.0", id: packet.id, result: {} } } as MessageEvent));
        }
      },
    };
    const hostWindow = {
      parent: parentWindow,
      addEventListener: (_type: string, handler: (event: MessageEvent) => void) => {
        listener = handler;
      },
      removeEventListener: () => undefined,
    } as unknown as Window;
    const bridge = new McpAppsBridge(hostWindow, 100);
    let receivedInput: unknown;
    let receivedResult: unknown;
    bridge.onToolInput = (params) => {
      receivedInput = params;
    };
    bridge.onToolResult = (params) => {
      receivedResult = params;
    };

    await expect(bridge.connect()).resolves.toBe(true);
    expect(sent.map((message) => message.method)).toEqual(["ui/initialize", "ui/notifications/initialized"]);
    listener?.({ source: parentWindow, data: { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { taskId: "task-a" } } } } as MessageEvent);
    listener?.({ source: parentWindow, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { task: { id: "task-a" } } } } } as MessageEvent);
    expect(receivedInput).toEqual({ arguments: { taskId: "task-a" } });
    expect(receivedResult).toEqual({ structuredContent: { task: { id: "task-a" } } });

    await expect(bridge.callTool("task.get", { taskId: "task-a" })).resolves.toEqual({ structuredContent: { ok: true } });
    await expect(bridge.sendMessage("Open task-a in chat.")).resolves.toEqual({});
    expect(sent.map((message) => message.method)).toEqual([
      "ui/initialize",
      "ui/notifications/initialized",
      "tools/call",
      "ui/message",
    ]);
    bridge.dispose();
  });

  it("advertises the read and write tools with optional UI resources", async () => {
    await withMcp(async (_service, _database, client) => {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "project.list",
        "project.get",
        "board.get",
        "task.get",
        "task.list",
        "inbox.get",
        "handoff.generate",
        "task.create",
        "task.update",
        "session.create",
        "session.assign",
        "artifact.attach",
        "relation.create",
      ]);
      expect(tools.tools.find((tool) => tool.name === "board.get")?._meta).toEqual(
        expect.objectContaining({
          "openai/outputTemplate": UI_RESOURCE_URIS.board,
          ui: { resourceUri: UI_RESOURCE_URIS.board },
        }),
      );
      expect(tools.tools.find((tool) => tool.name === "task.create")?.annotations).toEqual(
        expect.objectContaining({ readOnlyHint: false, destructiveHint: false }),
      );
    });
  });

  it("rejects DNS-rebinding hosts and non-allowlisted browser origins", async () => {
    expect(isAllowedMcpOrigin("https://evil.example")).toBe(false);
    expect(isAllowedMcpOrigin("http://localhost:6274")).toBe(true);
    expect(isAllowedMcpOrigin("https://chatgpt.com", ["https://chatgpt.com"])).toBe(true);

    const database = new WorkDeckDatabase(":memory:");
    const { server, url } = await startHttpApp(createMcpApp(new WorkDeckService(database)));
    try {
      const rejectedOrigin = await fetch(`${url}/health`, { headers: { Origin: "https://evil.example" } });
      expect(rejectedOrigin.status).toBe(403);

      const acceptedOrigin = await fetch(`${url}/health`, { headers: { Origin: "http://localhost:6274" } });
      expect(acceptedOrigin.status).toBe(200);
      expect(acceptedOrigin.headers.get("access-control-allow-origin")).toBe("http://localhost:6274");

      const rejectedHost = await httpHealth(url, { Host: "evil.example" });
      expect(rejectedHost.statusCode).toBe(403);
    } finally {
      await stopHttpApp(server);
      database.close();
    }
  });

  it("keeps REST and MCP on independent connections to one SQLite file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workdeck-dual-"));
    const filePath = join(directory, "shared.db");
    const apiDatabase = new WorkDeckDatabase(filePath);
    const mcpDatabase = new WorkDeckDatabase(filePath);
    const apiService = new WorkDeckService(apiDatabase);
    const mcpService = new WorkDeckService(mcpDatabase);
    const { server, url } = await startHttpApp(createApp(apiService));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpServer = createWorkDeckMcpServer(mcpService);
    const client = new Client({ name: "workdeck-dual-connection-test", version: "0.1.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(apiDatabase.busyTimeoutMs).toBe(5000);
      expect(apiDatabase.journalMode).toBe("wal");
      expect(mcpDatabase.busyTimeoutMs).toBe(5000);
      expect(mcpDatabase.journalMode).toBe("wal");

      const projectResponse = await fetch(`${url}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Shared project" }),
      });
      const project = ((await projectResponse.json()) as any).project;
      const taskResponse = await fetch(`${url}/api/projects/${project.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Created by REST", status: "implementing", priority: "high" }),
      });
      const restTask = ((await taskResponse.json()) as any).task;

      const mcpRead = structured(await client.callTool({ name: "task.get", arguments: { taskId: restTask.id } }));
      expect(mcpRead.task.title).toBe("Created by REST");

      const mcpCreated = structured(
        await client.callTool({ name: "task.create", arguments: { projectId: project.id, title: "Created by MCP", status: "reviewing" } }),
      );
      const restRead = await fetch(`${url}/api/tasks/${mcpCreated.task.id}`);
      expect(restRead.status).toBe(200);
      expect(((await restRead.json()) as any).task.title).toBe("Created by MCP");

      const updatedByMcpConnection = mcpDatabase.updateTask(restTask.id, { status: "reviewing" });
      expect(apiDatabase.getTask(restTask.id)?.status).toBe("reviewing");
      expect(updatedByMcpConnection.status).toBe("reviewing");

      await Promise.all([
        runConcurrentSqliteWorker(filePath, project.id, "A", 8),
        runConcurrentSqliteWorker(filePath, project.id, "B", 8),
      ]);
      expect(apiDatabase.listTasks(project.id).filter((task) => task.title.startsWith("Concurrent "))).toHaveLength(16);
    } finally {
      await client.close();
      await mcpServer.close();
      await stopHttpApp(server);
      apiDatabase.close();
      mcpDatabase.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns stable project, board, task, inbox and handoff contracts", async () => {
    await withMcp(async (service, database, client) => {
      const project = database.createProject({ name: "MCP project" });
      const taskA = database.createTask({ projectId: project.id, title: "Task A", status: "reviewing", priority: "high" });
      const taskB = database.createTask({ projectId: project.id, title: "Task B", status: "implementing", priority: "medium" });
      const session = database.createSession({ projectId: project.id, name: "Long Chat", provider: "chatgpt", status: "active" });
      database.assignSessionToTask({ taskId: taskA.id, sessionId: session.id, role: "reviewer" });
      const artifactA = database.createArtifactForTask(taskA.id, { type: "commit", title: "commit-A", externalRef: "a1" });
      database.createArtifactForTask(taskB.id, { type: "commit", title: "commit-B", externalRef: "b1" });

      const projects = structured(await client.callTool({ name: "project.list", arguments: {} }));
      expect(projects.projects).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id, taskCount: 2 })]));

      const board = structured(await client.callTool({ name: "board.get", arguments: { projectId: project.id } }));
      const boardTaskA = board.columns.flatMap((column: any) => column.tasks).find((task: any) => task.id === taskA.id);
      const boardTaskB = board.columns.flatMap((column: any) => column.tasks).find((task: any) => task.id === taskB.id);
      expect(boardTaskA.latestArtifact.title).toBe("commit-A");
      expect(boardTaskB.latestArtifact.title).toBe("commit-B");
      expect(boardTaskA.sessions.total).toBe(1);

      const detail = structured(await client.callTool({ name: "task.get", arguments: { taskId: taskA.id } }));
      expect(detail.task.title).toBe("Task A");
      expect(detail.artifacts.map((artifact: any) => artifact.title)).toEqual(["commit-A"]);
      expect(detail.artifacts.map((artifact: any) => artifact.title)).not.toContain("commit-B");

      const inbox = structured(await client.callTool({ name: "inbox.get", arguments: { projectId: project.id } }));
      expect(inbox.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "review", taskId: taskA.id, title: "Task A" }),
          expect.objectContaining({ type: "active", taskId: taskA.id, title: "Task A" }),
        ]),
      );

      const handoff = structured(await client.callTool({ name: "handoff.generate", arguments: { taskId: taskA.id } }));
      expect(handoff).toEqual(expect.objectContaining({ taskId: taskA.id, projectId: project.id }));
      expect(handoff.markdown).toContain("commit-A");
      expect(handoff.markdown).not.toContain("commit-B");

      const resource = await client.readResource({ uri: UI_RESOURCE_URIS.board });
      expect(resource.contents[0]).toEqual(
        expect.objectContaining({ uri: UI_RESOURCE_URIS.board, mimeType: "text/html;profile=mcp-app" }),
      );
      expect((resource.contents[0] as { text?: string }).text).toContain("__WORKDECK_TEST__");
      void service;
      void artifactA;
    });
  });

  it("keeps write tools on the shared service and preserves validation", async () => {
    await withMcp(async (service, database, client) => {
      const project = database.createProject({ name: "Write project" });
      const createdTask = structured(
        await client.callTool({
          name: "task.create",
          arguments: { projectId: project.id, title: "Created from MCP", status: "implementing", priority: "high" },
        }),
      );
      const taskId = createdTask.task.id as string;
      expect(service.getTaskDetail(taskId).task.title).toBe("Created from MCP");

      const updatedTask = structured(
        await client.callTool({ name: "task.update", arguments: { taskId, patch: { status: "reviewing", nextStep: "Review the result." } } }),
      );
      expect(updatedTask.task.status).toBe("reviewing");
      expect(database.getTask(taskId)?.nextStep).toBe("Review the result.");

      const createdSession = structured(
        await client.callTool({ name: "session.create", arguments: { projectId: project.id, name: "MCP Chat", provider: "chatgpt" } }),
      );
      const sessionId = createdSession.session.id as string;
      const assigned = structured(
        await client.callTool({ name: "session.assign", arguments: { taskId, sessionId, role: "reviewer" } }),
      );
      expect(assigned.session.taskId).toBe(taskId);
      expect(service.getTaskDetail(taskId).sessions[0].role).toBe("reviewer");

      const artifact = database.createArtifact({ projectId: project.id, type: "commit", title: "MCP commit", externalRef: "mcp-1" });
      const attached = structured(await client.callTool({ name: "artifact.attach", arguments: { taskId, artifactId: artifact.id } }));
      expect(attached.artifact.id).toBe(artifact.id);
      expect(service.getTaskDetail(taskId).artifacts.map((item) => item.id)).toContain(artifact.id);

      const relation = structured(
        await client.callTool({
          name: "relation.create",
          arguments: { sourceType: "task", sourceId: taskId, targetType: "artifact", targetId: artifact.id, relationType: "produces" },
        }),
      );
      expect(relation.relation.relationType).toBe("produces");

      const invalid = await client.callTool({
        name: "relation.create",
        arguments: { sourceType: "artifact", sourceId: artifact.id, targetType: "session", targetId: sessionId, relationType: "produces" },
      });
      expect(invalid.isError).toBe(true);
      expect((invalid as any).content[0]).toEqual(expect.objectContaining({ type: "text" }));

      const otherProject = database.createProject({ name: "Other project" });
      const otherTask = database.createTask({ projectId: otherProject.id, title: "Other task" });
      const crossProject = await client.callTool({ name: "session.assign", arguments: { taskId: otherTask.id, sessionId, role: "reviewer" } });
      expect(crossProject.isError).toBe(true);

      const invalidStatus = await client.callTool({ name: "task.update", arguments: { taskId, patch: { status: "not-a-status" } } });
      expect(invalidStatus.isError).toBe(true);
    });
  });
});
