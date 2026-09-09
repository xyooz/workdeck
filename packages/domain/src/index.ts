import { z } from "zod";

export const TASK_STATUSES = [
  "backlog",
  "designing",
  "implementing",
  "reviewing",
  "blocked",
  "done",
] as const;

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const PROVIDERS = ["chatgpt", "codex", "claude", "local", "other"] as const;
export const SESSION_ROLES = ["architect", "implementer", "reviewer", "researcher"] as const;
export const SESSION_STATUSES = ["active", "waiting", "completed", "failed", "archived"] as const;
export const ARTIFACT_TYPES = ["commit", "pull_request", "file", "report", "test_run", "other"] as const;
export const ENTITY_TYPES = ["project", "task", "session", "artifact"] as const;
export const RELATION_TYPES = [
  "implements",
  "reviews",
  "continues",
  "depends_on",
  "blocks",
  "produces",
  "fixes",
  "derived_from",
  "defines",
] as const;
export const TASK_EVENT_TYPES = [
  "task_created",
  "status_changed",
  "session_linked",
  "artifact_attached",
  "relation_created",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Provider = (typeof PROVIDERS)[number];
export type SessionRole = (typeof SESSION_ROLES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];
export type RelationType = (typeof RELATION_TYPES)[number];
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const TaskStatusSchema = z.enum(TASK_STATUSES);
export const PrioritySchema = z.enum(PRIORITIES);
export const ProviderSchema = z.enum(PROVIDERS);
export const SessionRoleSchema = z.enum(SESSION_ROLES);
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES);
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export const RelationTypeSchema = z.enum(RELATION_TYPES);
export const TaskEventTypeSchema = z.enum(TASK_EVENT_TYPES);

const id = z.string().trim().min(1, "id is required");
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().default(""),
});

export const CreateTaskInputSchema = z.object({
  projectId: id,
  parentTaskId: id.optional().nullable(),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(8000).optional().default(""),
  goal: z.string().trim().max(8000).optional().default(""),
  architectureNotes: z.string().trim().max(12000).optional().default(""),
  reviewContext: z.string().trim().max(12000).optional().default(""),
  acceptanceCriteria: z.string().trim().max(12000).optional().default(""),
  constraints: z.string().trim().max(12000).optional().default(""),
  nextStep: z.string().trim().max(4000).optional().default(""),
  status: TaskStatusSchema.default("backlog"),
  priority: PrioritySchema.default("medium"),
});

export const UpdateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(8000).optional(),
    goal: z.string().trim().max(8000).optional(),
    architectureNotes: z.string().trim().max(12000).optional(),
    reviewContext: z.string().trim().max(12000).optional(),
    acceptanceCriteria: z.string().trim().max(12000).optional(),
    constraints: z.string().trim().max(12000).optional(),
    nextStep: z.string().trim().max(4000).optional(),
    status: TaskStatusSchema.optional(),
    priority: PrioritySchema.optional(),
    parentTaskId: id.optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, "at least one task field is required");

export const CreateSessionInputSchema = z.object({
  projectId: id,
  taskId: id.optional().nullable(),
  name: z.string().trim().min(1).max(160),
  provider: ProviderSchema.default("other"),
  role: SessionRoleSchema.default("implementer"),
  status: SessionStatusSchema.default("active"),
  externalRef: optionalText(240),
  externalUrl: optionalText(1000),
  summary: optionalText(4000),
});

export const CreateArtifactInputSchema = z.object({
  projectId: id,
  type: ArtifactTypeSchema.default("other"),
  title: z.string().trim().min(1).max(240),
  externalRef: optionalText(240),
  externalUrl: optionalText(1000),
  metadata: z.record(z.unknown()).default({}),
});

export const CreateRelationInputSchema = z.object({
  sourceType: EntityTypeSchema,
  sourceId: id,
  targetType: EntityTypeSchema,
  targetId: id,
  relationType: RelationTypeSchema,
  metadata: z.record(z.unknown()).optional().nullable(),
});

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string;
  goal: string;
  architectureNotes: string;
  reviewContext: string;
  acceptanceCriteria: string;
  constraints: string;
  nextStep: string;
  status: TaskStatus;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  name: string;
  provider: Provider;
  status: SessionStatus;
  externalRef: string | null;
  externalUrl: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionAssignment {
  taskId: string;
  sessionId: string;
  role: SessionRole;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSession extends Session {
  taskId: string;
  role: SessionRole;
  assignmentCreatedAt: string;
  assignmentUpdatedAt: string;
}

export interface ProjectSession extends Session {
  assignments: SessionAssignment[];
}

export interface Artifact {
  id: string;
  projectId: string;
  type: ArtifactType;
  title: string;
  externalRef: string | null;
  externalUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Relation {
  id: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  relationType: RelationType;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  eventType: TaskEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HandoffRelation {
  source: string;
  relationType: RelationType;
  target: string;
}

export interface HandoffContext {
  projectName: string;
  task: Pick<Task, "title" | "description" | "goal" | "architectureNotes" | "reviewContext" | "acceptanceCriteria" | "constraints" | "nextStep" | "status" | "priority">;
  relatedTasks: Array<{ title: string; status: TaskStatus; relationType: RelationType }>;
  sessions: Array<Pick<TaskSession, "name" | "role" | "provider" | "status" | "summary">>;
  artifacts: Array<Pick<Artifact, "type" | "title" | "externalRef" | "externalUrl">>;
  dependencies: Array<{ title: string; relationType: RelationType }>;
  relations: HandoffRelation[];
  knownReviewFixContext: string[];
}

export class DomainError extends Error {
  readonly code: string;

  constructor(message: string, code = "domain_error") {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, "not_found");
    this.name = "NotFoundError";
  }
}

const labelize = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const relationize = (value: string) => value.replace(/_/g, " ");

const bulletList = (items: string[]) => (items.length ? items.map((item) => (item.startsWith("- ") ? item : `- ${item}`)).join("\n") : "- None");

export function renderHandoffMarkdown(context: HandoffContext): string {
  const { projectName, task } = context;
  const sessions = context.sessions.map(
    (session) =>
      `- ${session.name} — ${labelize(session.role)} · ${labelize(session.provider)} · ${labelize(session.status)}${
        session.summary ? ` — ${session.summary}` : ""
      }`,
  );
  const artifacts = context.artifacts.map(
    (artifact) =>
      `- ${labelize(artifact.type)}: ${artifact.title}${artifact.externalRef ? ` (${artifact.externalRef})` : ""}${
        artifact.externalUrl ? ` — ${artifact.externalUrl}` : ""
      }`,
  );
  const relatedTasks = context.relatedTasks.map(
    (related) => `- ${related.title} — ${relationize(related.relationType)} · ${labelize(related.status)}`,
  );
  const dependencies = context.dependencies.map(
    (dependency) => `- ${dependency.title} — ${relationize(dependency.relationType)}`,
  );
  const relations = context.relations.map(
    (relation) => `- ${relation.source} — ${relationize(relation.relationType)} → ${relation.target}`,
  );
  const reviewContext = [context.task.reviewContext, ...context.knownReviewFixContext].filter(Boolean);

  return `# ${projectName} — ${task.title} Handoff

## Goal

${task.goal || task.description || "No goal has been recorded yet."}

## Current Status

- Status: ${labelize(task.status)}
- Priority: ${labelize(task.priority)}

## Task Description

${task.description || "No additional task description."}

## Key Architecture Decisions

${task.architectureNotes || "- None recorded"}

## Related Tasks

${bulletList(relatedTasks)}

## Sessions

${bulletList(sessions)}

## Artifacts

${bulletList(artifacts)}

## Dependencies

${bulletList(dependencies)}

## Relations

${bulletList(relations)}

## Known Review / Fix Context

${reviewContext.length ? reviewContext.map((item) => (item.startsWith("- ") ? item : `- ${item}`)).join("\n") : "- None"}

## Acceptance Criteria

${task.acceptanceCriteria || "- None recorded"}

## Protected Constraints

${task.constraints || "- None recorded"}

## Next Step

${task.nextStep || "Continue from the current status and preserve the relations and artifacts listed above."}
`;
}

export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;
export type CreateSessionInput = z.input<typeof CreateSessionInputSchema>;
export type CreateArtifactInput = z.input<typeof CreateArtifactInputSchema>;
export type CreateRelationInput = z.input<typeof CreateRelationInputSchema>;
