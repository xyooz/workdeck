import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkDeckService } from "@workdeck/api";
import {
  ArtifactResultSchema,
  AssignSessionCommandSchema,
  AttachArtifactCommandSchema,
  BoardViewSchema,
  CreateRelationCommandSchema,
  CreateSessionCommandSchema,
  CreateTaskCommandSchema,
  EmptyInputSchema,
  HandoffResultSchema,
  InboxInputSchema,
  InboxResultSchema,
  ProjectIdInputSchema,
  ProjectListResultSchema,
  ProjectResultSchema,
  RelationResultSchema,
  SessionResultSchema,
  TaskDetailViewSchema,
  TaskIdInputSchema,
  TaskListResultSchema,
  TaskResultSchema,
  TaskSessionResultSchema,
  UpdateTaskCommandSchema,
  toArtifactView,
  toBoardView,
  toHandoffResult,
  toProjectListItem,
  toProjectSessionView,
  toProjectView,
  toRelationView,
  toSessionView,
  toTaskCardView,
  toTaskDetailView,
  toTaskSessionView,
  toTaskView,
} from "@workdeck/app-contracts";

export const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
export const UI_RESOURCE_URIS = {
  task: "ui://workdeck/current-task/v1.html",
  board: "ui://workdeck/mini-board/v1.html",
  inbox: "ui://workdeck/inbox/v1.html",
} as const;

type ToolResult = {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type WidgetMode = "task" | "board" | "inbox";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

const toolMeta = (resourceUri?: string, invoking = "Working…", invoked = "Ready.") => ({
  ...(resourceUri
    ? {
        ui: { resourceUri },
        "openai/outputTemplate": resourceUri,
      }
    : {}),
  "openai/toolInvocation/invoking": invoking,
  "openai/toolInvocation/invoked": invoked,
});

const textFor = (value: unknown) => JSON.stringify(value, null, 2);

function ok<T extends Record<string, unknown>>(structuredContent: T, text = textFor(structuredContent)): ToolResult {
  return {
    structuredContent,
    content: [{ type: "text", text }],
  };
}

function failed(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : "Unexpected WorkDeck error";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

async function safely<T>(handler: () => T | Promise<T>): Promise<T | ToolResult> {
  try {
    return await handler();
  } catch (error) {
    return failed(error);
  }
}

function registerResource(server: McpServer, name: string, uri: string, mode: WidgetMode, component: string) {
  const resourceMeta = {
    ui: {
      prefersBorder: true,
      ...(mode === "task" ? { permissions: { clipboardWrite: {} } } : {}),
    },
  };
  server.registerResource(name, uri, {}, async () => ({
    contents: [
      {
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: `<div id="root"></div><script>window.__WORKDECK_WIDGET_MODE__=${JSON.stringify(mode)};</script><script type="module">${component}</script>`,
        _meta: resourceMeta,
      },
    ],
  }));
}

export function registerWorkDeckTools(server: McpServer, service: WorkDeckService) {
  server.registerTool(
    "project.list",
    {
      title: "List projects",
      description: "List WorkDeck projects and their task counts.",
      inputSchema: EmptyInputSchema,
      outputSchema: ProjectListResultSchema,
      annotations: readOnlyAnnotations,
      _meta: toolMeta(undefined, "Loading projects…", "Projects ready."),
    },
    async () =>
      safely(() => {
        const structuredContent = ProjectListResultSchema.parse({ projects: service.listProjects().map(toProjectListItem) });
        return ok(structuredContent, `Found ${structuredContent.projects.length} WorkDeck projects.`);
      }),
  );

  server.registerTool(
    "project.get",
    {
      title: "Get project",
      description: "Open one WorkDeck project by ID.",
      inputSchema: ProjectIdInputSchema,
      outputSchema: ProjectResultSchema,
      annotations: readOnlyAnnotations,
      _meta: toolMeta(undefined, "Loading project…", "Project ready."),
    },
    async ({ projectId }) =>
      safely(() => ok(ProjectResultSchema.parse({ project: toProjectView(service.getProject(projectId)) }))),
  );

  server.registerTool(
    "board.get",
    {
      title: "Get project board",
      description: "Show a compact WorkDeck board grouped by task status.",
      inputSchema: ProjectIdInputSchema,
      outputSchema: BoardViewSchema,
      annotations: readOnlyAnnotations,
      _meta: toolMeta(UI_RESOURCE_URIS.board, "Loading board…", "Board ready."),
    },
    async ({ projectId }) =>
      safely(() => {
        const structuredContent = toBoardView(service.getBoard(projectId));
        return ok(structuredContent, `Board for ${structuredContent.project.name} is ready.`);
      }),
  );

  server.registerTool(
    "task.get",
    {
      title: "Get task",
      description: "Inspect one WorkDeck task with its scoped sessions, artifacts, relations and event trail.",
      inputSchema: TaskIdInputSchema,
      outputSchema: TaskDetailViewSchema,
      annotations: readOnlyAnnotations,
      _meta: toolMeta(UI_RESOURCE_URIS.task, "Loading task…", "Task ready."),
    },
    async ({ taskId }) =>
      safely(() => {
        const structuredContent = toTaskDetailView(service.getTaskDetail(taskId));
        return ok(structuredContent, `Task ${structuredContent.task.title} is ready.`);
      }),
  );

  server.registerTool(
    "task.list",
    {
      title: "List project tasks",
      description: "List compact task cards for one WorkDeck project.",
      inputSchema: ProjectIdInputSchema,
      outputSchema: TaskListResultSchema,
      annotations: readOnlyAnnotations,
      _meta: toolMeta(undefined, "Loading tasks…", "Tasks ready."),
    },
    async ({ projectId }) =>
      safely(() => {
        const structuredContent = TaskListResultSchema.parse({
          tasks: service.getBoard(projectId).tasks.map(toTaskCardView),
        });
        return ok(structuredContent, `Found ${structuredContent.tasks.length} tasks.`);
      }),
  );

  server.registerTool(
    "inbox.get",
    {
      title: "Get inbox",
      description: "Show WorkDeck attention items projected from blocked tasks, review status and session status.",
      inputSchema: InboxInputSchema,
      outputSchema: InboxResultSchema,
      annotations: readOnlyAnnotations,
      _meta: toolMeta(UI_RESOURCE_URIS.inbox, "Loading inbox…", "Inbox ready."),
    },
    async ({ projectId }) =>
      safely(() => {
        const structuredContent = InboxResultSchema.parse({ items: service.getInbox(projectId) });
        return ok(structuredContent, `${structuredContent.items.length} inbox item${structuredContent.items.length === 1 ? "" : "s"}.`);
      }),
  );

  server.registerTool(
    "handoff.generate",
    {
      title: "Generate handoff",
      description: "Generate the portable Markdown handoff for one WorkDeck task.",
      inputSchema: TaskIdInputSchema,
      outputSchema: HandoffResultSchema,
      annotations: readOnlyAnnotations,
      _meta: toolMeta(undefined, "Generating handoff…", "Handoff ready."),
    },
    async ({ taskId }) =>
      safely(() => {
        const handoff = service.getHandoff(taskId);
        return ok(toHandoffResult(handoff.taskId, handoff.projectId, handoff.markdown), handoff.markdown);
      }),
  );

  server.registerTool(
    "task.create",
    {
      title: "Create task",
      description: "Create a task in a WorkDeck project after validating its status, priority and parent hierarchy.",
      inputSchema: CreateTaskCommandSchema,
      outputSchema: TaskResultSchema,
      annotations: writeAnnotations,
      _meta: toolMeta(undefined, "Creating task…", "Task created."),
    },
    async ({ projectId, ...input }) =>
      safely(() => ok(TaskResultSchema.parse({ task: toTaskView(service.createTask(projectId, input)) }))),
  );

  server.registerTool(
    "task.update",
    {
      title: "Update task",
      description: "Update an existing WorkDeck task using the shared application validation, including parent-cycle protection.",
      inputSchema: UpdateTaskCommandSchema,
      outputSchema: TaskResultSchema,
      annotations: writeAnnotations,
      _meta: toolMeta(undefined, "Updating task…", "Task updated."),
    },
    async ({ taskId, patch }) =>
      safely(() => ok(TaskResultSchema.parse({ task: toTaskView(service.updateTask(taskId, patch)) }))),
  );

  server.registerTool(
    "session.create",
    {
      title: "Create session",
      description: "Register a provider-neutral WorkDeck session. Assign it to a task separately with session.assign.",
      inputSchema: CreateSessionCommandSchema,
      outputSchema: SessionResultSchema,
      annotations: writeAnnotations,
      _meta: toolMeta(undefined, "Registering session…", "Session registered."),
    },
    async (input) =>
      safely(() => ok(SessionResultSchema.parse({ session: toSessionView(service.createSession(input)) }))),
  );

  server.registerTool(
    "session.assign",
    {
      title: "Assign session",
      description: "Assign an existing WorkDeck session to a task with a per-task role; the session and task must share a project.",
      inputSchema: AssignSessionCommandSchema,
      outputSchema: TaskSessionResultSchema,
      annotations: writeAnnotations,
      _meta: toolMeta(undefined, "Assigning session…", "Session assigned."),
    },
    async (input) =>
      safely(() => ok(TaskSessionResultSchema.parse({ session: toTaskSessionView(service.assignSessionToTask(input)) }))),
  );

  server.registerTool(
    "artifact.attach",
    {
      title: "Attach artifact",
      description: "Attach an existing WorkDeck artifact to a task through explicit Task → produces → Artifact ownership.",
      inputSchema: AttachArtifactCommandSchema,
      outputSchema: ArtifactResultSchema,
      annotations: writeAnnotations,
      _meta: toolMeta(undefined, "Attaching artifact…", "Artifact attached."),
    },
    async (input) =>
      safely(() => ok(ArtifactResultSchema.parse({ artifact: toArtifactView(service.attachArtifactToTask(input)) }))),
  );

  server.registerTool(
    "relation.create",
    {
      title: "Create relation",
      description: "Create a validated WorkDeck relation. Endpoint compatibility, same-project rules and idempotency remain enforced by the core service.",
      inputSchema: CreateRelationCommandSchema,
      outputSchema: RelationResultSchema,
      annotations: writeAnnotations,
      _meta: toolMeta(undefined, "Recording relation…", "Relation recorded."),
    },
    async (input) =>
      safely(() => ok(RelationResultSchema.parse({ relation: toRelationView(service.createRelation(input)) }))),
  );
}

export function registerWorkDeckResources(server: McpServer, component: string) {
  registerResource(server, "workdeck-current-task", UI_RESOURCE_URIS.task, "task", component);
  registerResource(server, "workdeck-mini-board", UI_RESOURCE_URIS.board, "board", component);
  registerResource(server, "workdeck-inbox", UI_RESOURCE_URIS.inbox, "inbox", component);
}

export function createWorkDeckMcpServer(service: WorkDeckService, component = "") {
  const server = new McpServer(
    { name: "workdeck", version: "0.2.0" },
    {
      instructions:
        "Use WorkDeck tools as the task-centric source of truth for projects, tasks, sessions, artifacts and handoffs. Read the relevant task or project before changing it. Write tools are limited to validated WorkDeck operations.",
    },
  );
  registerWorkDeckResources(server, component);
  registerWorkDeckTools(server, service);
  return server;
}

export const mcpInputSchemas = {
  projectList: EmptyInputSchema,
  project: ProjectIdInputSchema,
  task: TaskIdInputSchema,
  inbox: InboxInputSchema,
  createTask: CreateTaskCommandSchema,
  updateTask: UpdateTaskCommandSchema,
  createSession: CreateSessionCommandSchema,
  assignSession: AssignSessionCommandSchema,
  attachArtifact: AttachArtifactCommandSchema,
  createRelation: CreateRelationCommandSchema,
  string: z.string(),
};
