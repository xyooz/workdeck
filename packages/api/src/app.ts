import cors from "cors";
import express, { type Request, type Response } from "express";
import {
  CreateArtifactInputSchema,
  AssignSessionToTaskInputSchema,
  CreateProjectInputSchema,
  CreateRelationInputSchema,
  CreateSessionInputSchema,
  CreateTaskInputSchema,
  DomainError,
  NotFoundError,
  renderHandoffMarkdown,
  SessionRoleSchema,
  UpdateTaskInputSchema,
  type Artifact,
  type EntityType,
  type Project,
  type Relation,
  type Session,
  type Task,
} from "@workdeck/domain";
import { WorkDeckDatabase } from "@workdeck/db";
import {
  AttachArtifactCommandSchema,
  toArtifactView,
  toBoardView,
  toHandoffResult,
  toProjectListItem,
  toProjectSessionView,
  toProjectView,
  toRelationView,
  toTaskCardView,
  toTaskDetailView,
  toTaskSessionView,
  toTaskView,
  type InboxItem,
} from "@workdeck/app-contracts";

const displayNames: Record<string, string> = {
  project: "Project",
  task: "Task",
  session: "Session",
  artifact: "Artifact",
};

const titleize = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export class WorkDeckService {
  constructor(readonly db: WorkDeckDatabase) {}

  listProjects() {
    return this.db.listProjects();
  }

  getProject(projectId: string) {
    return this.requireProject(projectId);
  }

  createProject(input: unknown) {
    return this.db.createProject(CreateProjectInputSchema.parse(input));
  }

  getBoard(projectId: string) {
    const project = this.requireProject(projectId);
    const tasks = this.db.listTasks(projectId).map((task) => this.toBoardTask(task));
    return { project, tasks };
  }

  listTasks(projectId: string) {
    this.requireProject(projectId);
    return this.db.listTasks(projectId);
  }

  listProjectSessions(projectId: string) {
    this.requireProject(projectId);
    return this.db.listSessionsForProject(projectId);
  }

  createTask(projectId: string, input: unknown) {
    const parsed = CreateTaskInputSchema.parse({ ...(input as Record<string, unknown>), projectId });
    return this.db.createTask(parsed);
  }

  getTaskDetail(taskId: string) {
    const task = this.requireTask(taskId);
    const project = this.requireProject(task.projectId);
    const parent = task.parentTaskId ? this.db.getTask(task.parentTaskId) : null;
    const sessions = this.db.listSessionsForTask(task.id);
    const artifacts = this.db.listArtifactsForTask(task.id);
    const relations = this.relationsForTask(task);
    return {
      task,
      project,
      parentTask: parent,
      sessions,
      artifacts,
      latestArtifact: artifacts[0] ?? null,
      relations: relations.map((relation) => this.enrichRelation(relation)),
      events: this.db.listTaskEvents(task.id),
    };
  }

  updateTask(taskId: string, input: unknown) {
    return this.db.updateTask(taskId, UpdateTaskInputSchema.parse(input));
  }

  createSessionForTask(taskId: string, input: unknown) {
    const task = this.requireTask(taskId);
    const body = (input ?? {}) as Record<string, unknown>;
    if (typeof body.sessionId === "string" && body.sessionId.trim()) {
      return this.db.assignSessionToTask(AssignSessionToTaskInputSchema.parse({ ...body, taskId }));
    }
    const { role: roleInput, sessionId: _sessionId, ...sessionInput } = body;
    const role = SessionRoleSchema.parse(roleInput ?? "implementer");
    const parsed = CreateSessionInputSchema.parse({ ...sessionInput, projectId: task.projectId });
    const session = this.db.createSession(parsed);
    return this.db.assignSessionToTask({ taskId, sessionId: session.id, role });
  }

  createSession(input: unknown) {
    return this.db.createSession(CreateSessionInputSchema.parse(input));
  }

  assignSessionToTask(input: unknown) {
    return this.db.assignSessionToTask(AssignSessionToTaskInputSchema.parse(input));
  }

  createArtifactForTask(taskId: string, input: unknown) {
    const parsed = CreateArtifactInputSchema.omit({ projectId: true }).parse(input);
    return this.db.createArtifactForTask(taskId, parsed);
  }

  attachArtifactToTask(input: unknown) {
    const parsed = AttachArtifactCommandSchema.parse(input);
    return this.db.attachArtifactToTask(parsed.taskId, parsed.artifactId);
  }

  createRelation(input: unknown) {
    return this.enrichRelation(this.db.createRelation(CreateRelationInputSchema.parse(input)));
  }

  getInbox(projectId?: string): InboxItem[] {
    const projects = projectId ? [this.requireProject(projectId)] : this.db.listProjects();
    const tasks = projects.flatMap((project) => this.db.listTasks(project.id));
    const items: InboxItem[] = [];
    const priorityRank: Record<Task["priority"], number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const typeRank: Record<InboxItem["type"], number> = { needs_attention: 0, failed: 1, review: 2, waiting: 3, active: 4 };

    for (const task of tasks) {
      if (task.status === "blocked") {
        items.push({
          type: "needs_attention",
          taskId: task.id,
          title: task.title,
          reason: "Task is blocked",
          priority: task.priority,
          updatedAt: task.updatedAt,
        });
      }
      if (task.status === "reviewing") {
        items.push({
          type: "review",
          taskId: task.id,
          title: task.title,
          reason: "Task is ready for review",
          priority: task.priority,
          updatedAt: task.updatedAt,
        });
      }

      for (const session of this.db.listSessionsForTask(task.id)) {
        if (!["active", "waiting", "failed"].includes(session.status)) continue;
        const type = session.status as Extract<InboxItem["type"], "active" | "waiting" | "failed">;
        items.push({
          type,
          taskId: task.id,
          title: task.title,
          reason: `${session.name} is ${session.status}`,
          priority: task.priority,
          updatedAt: [task.updatedAt, session.updatedAt, session.assignmentUpdatedAt].sort().at(-1) ?? task.updatedAt,
        });
      }
    }

    return items.sort((left, right) => {
      const priority = priorityRank[left.priority] - priorityRank[right.priority];
      if (priority) return priority;
      const type = typeRank[left.type] - typeRank[right.type];
      if (type) return type;
      return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
    });
  }

  getHandoff(taskId: string) {
    const detail = this.getTaskDetail(taskId);
    const relatedTasks = detail.relations
      .filter((relation) => relation.source.type === "task" || relation.target.type === "task")
      .map((relation) => {
        const other = relation.source.type === "task" && relation.source.id === taskId ? relation.target : relation.source;
        return other.type === "task" ? { title: other.label, status: this.requireTask(other.id).status, relationType: relation.relationType } : null;
      })
      .filter((value): value is { title: string; status: Task["status"]; relationType: Relation["relationType"] } => value !== null)
      .filter((item, index, items) => items.findIndex((candidate) => candidate.title === item.title && candidate.relationType === item.relationType) === index);
    const dependencies = relatedTasks.filter((item) => item.relationType === "depends_on" || item.relationType === "blocks");
    const reviewFixContext = detail.relations
      .filter((relation) => ["reviews", "fixes", "blocks"].includes(relation.relationType))
      .map((relation) => `${relation.source.label} ${titleize(relation.relationType).toLowerCase()} ${relation.target.label}`);
    const markdown = renderHandoffMarkdown({
      projectName: detail.project.name,
      task: detail.task,
      relatedTasks,
      sessions: detail.sessions,
      artifacts: detail.artifacts,
      dependencies,
      relations: detail.relations.map((relation) => ({
        source: relation.source.label,
        relationType: relation.relationType,
        target: relation.target.label,
      })),
      knownReviewFixContext: reviewFixContext,
    });
    return { taskId: detail.task.id, projectId: detail.project.id, markdown };
  }

  private toBoardTask(task: Task) {
    const sessions = this.db.listSessionsForTask(task.id);
    const artifacts = this.db.listArtifactsForTask(task.id);
    return {
      ...task,
      sessions,
      artifacts,
      latestArtifact: artifacts[0] ?? null,
    };
  }

  private relationsForTask(task: Task) {
    return this.db.listRelationsForTask(task.id);
  }

  private enrichRelation(relation: Relation) {
    return {
      ...relation,
      source: this.entitySummary(relation.sourceType, relation.sourceId),
      target: this.entitySummary(relation.targetType, relation.targetId),
    };
  }

  private entitySummary(type: EntityType, id: string) {
    const entity = this.db.getEntity(type, id);
    if (!entity) return { type, id, label: `${displayNames[type]} ${id}` };
    return { type, id, label: this.entityLabel(type, entity) };
  }

  private entityLabel(type: EntityType, entity: Project | Task | Session | Artifact) {
    if (type === "project") return (entity as Project).name;
    if (type === "task") return (entity as Task).title;
    if (type === "session") return (entity as Session).name;
    return (entity as Artifact).title;
  }

  private requireProject(id: string) {
    const project = this.db.getProject(id);
    if (!project) throw new NotFoundError(`Project ${id} was not found`);
    return project;
  }

  private requireTask(id: string) {
    const task = this.db.getTask(id);
    if (!task) throw new NotFoundError(`Task ${id} was not found`);
    return task;
  }
}

function errorResponse(error: unknown, response: Response) {
  if (error instanceof NotFoundError) return response.status(404).json({ error: error.message, code: error.code });
  if (error instanceof DomainError) return response.status(400).json({ error: error.message, code: error.code });
  if (error && typeof error === "object" && "issues" in error) {
    return response.status(400).json({ error: "Validation failed", issues: (error as { issues: unknown }).issues });
  }
  console.error(error);
  return response.status(500).json({ error: "Unexpected server error" });
}

function safe(handler: (request: Request, response: Response) => unknown) {
  return (request: Request, response: Response) => {
    try {
      return handler(request, response);
    } catch (error) {
      return errorResponse(error, response);
    }
  };
}

export function createApp(service: WorkDeckService) {
  const app = express();
  app.use(cors({ origin: "http://127.0.0.1:5173" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => response.json({ ok: true, service: "workdeck" }));
  app.get("/api/projects", safe((_request, response) => response.json({ projects: service.listProjects().map(toProjectListItem) })));
  app.post("/api/projects", safe((request, response) => response.status(201).json({ project: toProjectView(service.createProject(request.body)) })));
  app.get("/api/projects/:projectId", safe((request, response) => response.json({ project: toProjectView(service.getProject(String(request.params.projectId))) })));
  app.get("/api/projects/:projectId/board", safe((request, response) => response.json(toBoardView(service.getBoard(String(request.params.projectId))))));
  app.get("/api/projects/:projectId/tasks", safe((request, response) => response.json({ tasks: service.getBoard(String(request.params.projectId)).tasks.map(toTaskCardView) })));
  app.get("/api/projects/:projectId/sessions", safe((request, response) => response.json({ sessions: service.listProjectSessions(String(request.params.projectId)).map(toProjectSessionView) })));
  app.get("/api/inbox", safe((request, response) => response.json({ items: service.getInbox(typeof request.query.projectId === "string" ? request.query.projectId : undefined) })));
  app.post("/api/projects/:projectId/tasks", safe((request, response) => response.status(201).json({ task: toTaskView(service.createTask(String(request.params.projectId), request.body)) })));
  app.get("/api/tasks/:taskId", safe((request, response) => response.json(toTaskDetailView(service.getTaskDetail(String(request.params.taskId))))));
  app.patch("/api/tasks/:taskId", safe((request, response) => response.json({ task: toTaskView(service.updateTask(String(request.params.taskId), request.body)) })));
  app.post("/api/tasks/:taskId/sessions", safe((request, response) => response.status(201).json({ session: toTaskSessionView(service.createSessionForTask(String(request.params.taskId), request.body)) })));
  app.post("/api/tasks/:taskId/artifacts", safe((request, response) => response.status(201).json({ artifact: toArtifactView(service.createArtifactForTask(String(request.params.taskId), request.body)) })));
  app.get("/api/tasks/:taskId/handoff", safe((request, response) => {
    const result = service.getHandoff(String(request.params.taskId));
    return response.json(toHandoffResult(result.taskId, result.projectId, result.markdown));
  }));
  app.post("/api/relations", safe((request, response) => response.status(201).json({ relation: toRelationView(service.createRelation(request.body)) })));

  app.use((_request, response) => response.status(404).json({ error: "Route not found" }));
  return app;
}
