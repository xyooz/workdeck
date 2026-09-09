import cors from "cors";
import express, { type Request, type Response } from "express";
import {
  CreateArtifactInputSchema,
  CreateProjectInputSchema,
  CreateRelationInputSchema,
  CreateSessionInputSchema,
  CreateTaskInputSchema,
  DomainError,
  NotFoundError,
  renderHandoffMarkdown,
  UpdateTaskInputSchema,
  type Artifact,
  type EntityType,
  type Project,
  type Relation,
  type Session,
  type Task,
} from "@workdeck/domain";
import { WorkDeckDatabase } from "@workdeck/db";

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

  createProject(input: unknown) {
    return this.db.createProject(CreateProjectInputSchema.parse(input));
  }

  getBoard(projectId: string) {
    const project = this.requireProject(projectId);
    const tasks = this.db.listTasks(projectId).map((task) => this.toBoardTask(task));
    return { project, tasks };
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
    const relations = this.relationsForTask(task, sessions);
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
      return this.db.linkSessionToTask(body.sessionId, taskId);
    }
    const parsed = CreateSessionInputSchema.parse({ ...body, projectId: task.projectId, taskId });
    return this.db.createSession(parsed);
  }

  createArtifactForTask(taskId: string, input: unknown) {
    const parsed = CreateArtifactInputSchema.omit({ projectId: true }).parse(input);
    return this.db.createArtifactForTask(taskId, parsed);
  }

  createRelation(input: unknown) {
    return this.db.createRelation(CreateRelationInputSchema.parse(input));
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
    return { markdown };
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

  private relationsForTask(task: Task, sessions: Session[]) {
    const all = [
      ...this.db.listRelationsForEntity("task", task.id),
      ...sessions.flatMap((session) => this.db.listRelationsForEntity("session", session.id)),
    ];
    return Array.from(new Map(all.map((relation) => [relation.id, relation])).values());
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
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => response.json({ ok: true, service: "workdeck" }));
  app.get("/api/projects", safe((_request, response) => response.json({ projects: service.listProjects() })));
  app.post("/api/projects", safe((request, response) => response.status(201).json({ project: service.createProject(request.body) })));
  app.get("/api/projects/:projectId/board", safe((request, response) => response.json(service.getBoard(String(request.params.projectId)))));
  app.get("/api/projects/:projectId/sessions", safe((request, response) => response.json({ sessions: service.listProjectSessions(String(request.params.projectId)) })));
  app.post("/api/projects/:projectId/tasks", safe((request, response) => response.status(201).json({ task: service.createTask(String(request.params.projectId), request.body) })));
  app.get("/api/tasks/:taskId", safe((request, response) => response.json(service.getTaskDetail(String(request.params.taskId)))));
  app.patch("/api/tasks/:taskId", safe((request, response) => response.json({ task: service.updateTask(String(request.params.taskId), request.body) })));
  app.post("/api/tasks/:taskId/sessions", safe((request, response) => response.status(201).json({ session: service.createSessionForTask(String(request.params.taskId), request.body) })));
  app.post("/api/tasks/:taskId/artifacts", safe((request, response) => response.status(201).json({ artifact: service.createArtifactForTask(String(request.params.taskId), request.body) })));
  app.get("/api/tasks/:taskId/handoff", safe((request, response) => response.json(service.getHandoff(String(request.params.taskId)))));
  app.post("/api/relations", safe((request, response) => response.status(201).json({ relation: service.createRelation(request.body) })));

  app.use((_request, response) => response.status(404).json({ error: "Route not found" }));
  return app;
}
