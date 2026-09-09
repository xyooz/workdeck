import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WorkDeckService } from "@workdeck/api";
import { WorkDeckDatabase } from "@workdeck/db";
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

describe("WorkDeck Phase 0.2 MCP contracts", () => {
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
