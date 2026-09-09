import { z } from "zod";
import {
  AssignSessionToTaskInputSchema,
  CreateRelationInputSchema,
  CreateSessionInputSchema,
  CreateTaskInputSchema,
  PRIORITIES,
  RELATION_TYPES,
  SESSION_ROLES,
  TASK_STATUSES,
  TaskStatusSchema,
  PrioritySchema,
  ProviderSchema,
  SessionRoleSchema,
  SessionStatusSchema,
  ArtifactTypeSchema,
  UpdateTaskInputSchema,
  type Artifact,
  type Project,
  type Relation,
  type Session,
  type Task,
  type TaskEvent,
  type TaskSession,
} from "@workdeck/domain";

const id = z.string().trim().min(1, "id is required");

export const ProjectSummarySchema = z.object({
  id,
  name: z.string(),
});

export const ProjectViewSchema = ProjectSummarySchema.extend({
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProjectListItemSchema = ProjectViewSchema.extend({
  taskCount: z.number().int().nonnegative(),
});

export const ProjectListResultSchema = z.object({
  projects: z.array(ProjectListItemSchema),
});

export const ProjectResultSchema = z.object({
  project: ProjectViewSchema,
});

export const TaskViewSchema = z.object({
  id,
  projectId: id,
  parentTaskId: id.nullable(),
  title: z.string(),
  description: z.string(),
  goal: z.string(),
  architectureNotes: z.string(),
  reviewContext: z.string(),
  acceptanceCriteria: z.string(),
  constraints: z.string(),
  nextStep: z.string(),
  status: TaskStatusSchema,
  priority: PrioritySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ArtifactSummarySchema = z.object({
  id,
  type: ArtifactTypeSchema,
  title: z.string(),
  externalRef: z.string().nullable(),
});

export const TaskCardViewSchema = z.object({
  id,
  projectId: id,
  parentTaskId: id.nullable(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  priority: PrioritySchema,
  updatedAt: z.string(),
  sessions: z.object({
    active: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    assignments: z.array(
      z.object({
        name: z.string(),
        role: SessionRoleSchema,
      }),
    ),
  }),
  latestArtifact: ArtifactSummarySchema.nullable(),
});

export const BoardColumnSchema = z.object({
  status: TaskStatusSchema,
  tasks: z.array(TaskCardViewSchema),
});

export const BoardViewSchema = z.object({
  project: ProjectViewSchema,
  columns: z.array(BoardColumnSchema),
});

export const SessionViewSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  provider: ProviderSchema,
  status: SessionStatusSchema,
  externalRef: z.string().nullable(),
  externalUrl: z.string().nullable(),
  summary: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SessionAssignmentViewSchema = z.object({
  taskId: id,
  sessionId: id,
  role: SessionRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TaskSessionViewSchema = SessionViewSchema.extend({
  taskId: id,
  role: SessionRoleSchema,
  assignmentCreatedAt: z.string(),
  assignmentUpdatedAt: z.string(),
});

export const ProjectSessionViewSchema = SessionViewSchema.extend({
  assignments: z.array(SessionAssignmentViewSchema),
});

export const ArtifactViewSchema = z.object({
  id,
  projectId: id,
  type: ArtifactTypeSchema,
  title: z.string(),
  externalRef: z.string().nullable(),
  externalUrl: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});

export const RelationEndpointViewSchema = z.object({
  type: z.enum(["project", "task", "session", "artifact"]),
  id,
  label: z.string(),
});

export const RelationViewSchema = z.object({
  id,
  sourceType: z.enum(["project", "task", "session", "artifact"]),
  sourceId: id,
  targetType: z.enum(["project", "task", "session", "artifact"]),
  targetId: id,
  relationType: z.enum(RELATION_TYPES),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  source: RelationEndpointViewSchema,
  target: RelationEndpointViewSchema,
});

export const TaskEventViewSchema = z.object({
  id,
  taskId: id,
  eventType: z.string(),
  payload: z.record(z.unknown()),
  createdAt: z.string(),
});

export const TaskDetailViewSchema = z.object({
  task: TaskViewSchema,
  project: ProjectViewSchema,
  parentTask: TaskViewSchema.nullable(),
  sessions: z.array(TaskSessionViewSchema),
  artifacts: z.array(ArtifactViewSchema),
  latestArtifact: ArtifactViewSchema.nullable(),
  relations: z.array(RelationViewSchema),
  events: z.array(TaskEventViewSchema),
});

export const TaskListResultSchema = z.object({
  tasks: z.array(TaskCardViewSchema),
});

export const INBOX_ITEM_TYPES = ["needs_attention", "review", "active", "waiting", "failed"] as const;
export const InboxItemTypeSchema = z.enum(INBOX_ITEM_TYPES);

export const InboxItemSchema = z.object({
  type: InboxItemTypeSchema,
  taskId: id,
  title: z.string(),
  reason: z.string(),
  priority: PrioritySchema,
  updatedAt: z.string(),
});

export const InboxResultSchema = z.object({
  items: z.array(InboxItemSchema),
});

export const HandoffResultSchema = z.object({
  taskId: id,
  projectId: id,
  markdown: z.string(),
});

export const TaskResultSchema = z.object({ task: TaskViewSchema });
export const SessionResultSchema = z.object({ session: SessionViewSchema });
export const TaskSessionResultSchema = z.object({ session: TaskSessionViewSchema });
export const ArtifactResultSchema = z.object({ artifact: ArtifactViewSchema });
export const RelationResultSchema = z.object({ relation: RelationViewSchema });

export const ProjectIdInputSchema = z.object({ projectId: id }).strict();
export const TaskIdInputSchema = z.object({ taskId: id }).strict();
export const InboxInputSchema = z.object({ projectId: id.optional() }).strict();
export const EmptyInputSchema = z.object({}).strict();

export const CreateTaskCommandSchema = CreateTaskInputSchema;
export const UpdateTaskCommandSchema = z
  .object({
    taskId: id,
    patch: UpdateTaskInputSchema,
  })
  .strict();
export const CreateSessionCommandSchema = CreateSessionInputSchema;
export const AssignSessionCommandSchema = AssignSessionToTaskInputSchema;
export const AttachArtifactCommandSchema = z
  .object({
    taskId: id,
    artifactId: id,
  })
  .strict();
export const CreateRelationCommandSchema = CreateRelationInputSchema;

export type ProjectView = z.infer<typeof ProjectViewSchema>;
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;
export type TaskView = z.infer<typeof TaskViewSchema>;
export type TaskCardView = z.infer<typeof TaskCardViewSchema>;
export type BoardColumn = z.infer<typeof BoardColumnSchema>;
export type BoardView = z.infer<typeof BoardViewSchema>;
export type SessionView = z.infer<typeof SessionViewSchema>;
export type TaskSessionView = z.infer<typeof TaskSessionViewSchema>;
export type ProjectSessionView = z.infer<typeof ProjectSessionViewSchema>;
export type ArtifactView = z.infer<typeof ArtifactViewSchema>;
export type RelationView = z.infer<typeof RelationViewSchema>;
export type TaskDetailView = z.infer<typeof TaskDetailViewSchema>;
export type TaskEventView = z.infer<typeof TaskEventViewSchema>;
export type InboxItem = z.infer<typeof InboxItemSchema>;
export type HandoffResult = z.infer<typeof HandoffResultSchema>;

export type BoardTaskSource = Task & {
  sessions: TaskSession[];
  artifacts: Artifact[];
  latestArtifact: Artifact | null;
};

export type TaskDetailSource = {
  task: Task;
  project: Project;
  parentTask: Task | null;
  sessions: TaskSession[];
  artifacts: Artifact[];
  latestArtifact: Artifact | null;
  relations: Array<Relation & {
    source: { type: Relation["sourceType"]; id: string; label: string };
    target: { type: Relation["targetType"]; id: string; label: string };
  }>;
  events: TaskEvent[];
};

export function toProjectView(project: Project): ProjectView {
  return ProjectViewSchema.parse({
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
}

export function toProjectListItem(project: Project & { taskCount: number }): ProjectListItem {
  return ProjectListItemSchema.parse({ ...toProjectView(project), taskCount: project.taskCount });
}

export function toTaskView(task: Task): TaskView {
  return TaskViewSchema.parse(task);
}

export function toArtifactSummary(artifact: Artifact): z.infer<typeof ArtifactSummarySchema> {
  return ArtifactSummarySchema.parse({
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    externalRef: artifact.externalRef,
  });
}

export function toTaskCardView(task: BoardTaskSource): TaskCardView {
  return TaskCardViewSchema.parse({
    id: task.id,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    updatedAt: task.updatedAt,
    sessions: {
      active: task.sessions.filter((session) => session.status === "active").length,
      total: task.sessions.length,
      assignments: task.sessions.map((session) => ({ name: session.name, role: session.role })),
    },
    latestArtifact: task.latestArtifact ? toArtifactSummary(task.latestArtifact) : null,
  });
}

export function toBoardView(board: { project: Project; tasks: BoardTaskSource[] }): BoardView {
  return BoardViewSchema.parse({
    project: toProjectView(board.project),
    columns: TASK_STATUSES.map((status) => ({
      status,
      tasks: board.tasks.filter((task) => task.status === status).map(toTaskCardView),
    })),
  });
}

export function toSessionView(session: Session): SessionView {
  return SessionViewSchema.parse(session);
}

export function toTaskSessionView(session: TaskSession): TaskSessionView {
  return TaskSessionViewSchema.parse(session);
}

export function toProjectSessionView(session: Session & { assignments: Array<{ taskId: string; sessionId: string; role: TaskSession["role"]; createdAt: string; updatedAt: string }> }): ProjectSessionView {
  return ProjectSessionViewSchema.parse({
    ...toSessionView(session),
    assignments: session.assignments,
  });
}

export function toArtifactView(artifact: Artifact): ArtifactView {
  return ArtifactViewSchema.parse(artifact);
}

export function toRelationView(relation: TaskDetailSource["relations"][number]): RelationView {
  return RelationViewSchema.parse(relation);
}

export function toTaskEventView(event: TaskEvent): TaskEventView {
  return TaskEventViewSchema.parse(event);
}

export function toTaskDetailView(detail: TaskDetailSource): TaskDetailView {
  return TaskDetailViewSchema.parse({
    task: toTaskView(detail.task),
    project: toProjectView(detail.project),
    parentTask: detail.parentTask ? toTaskView(detail.parentTask) : null,
    sessions: detail.sessions.map(toTaskSessionView),
    artifacts: detail.artifacts.map(toArtifactView),
    latestArtifact: detail.latestArtifact ? toArtifactView(detail.latestArtifact) : null,
    relations: detail.relations.map(toRelationView),
    events: detail.events.map(toTaskEventView),
  });
}

export type InboxSource = InboxItem;

export function toInboxItem(item: InboxSource): InboxItem {
  return InboxItemSchema.parse(item);
}

export function toHandoffResult(taskId: string, projectId: string, markdown: string): HandoffResult {
  return HandoffResultSchema.parse({ taskId, projectId, markdown });
}

export const contractReference = {
  taskStatuses: TASK_STATUSES,
  priorities: PRIORITIES,
  sessionRoles: SESSION_ROLES,
};
