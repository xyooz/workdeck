import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import {
  ArtifactTypeSchema,
  CreateArtifactInputSchema,
  CreateProjectInputSchema,
  CreateRelationInputSchema,
  CreateSessionInputSchema,
  CreateTaskInputSchema,
  DomainError,
  NotFoundError,
  PrioritySchema,
  ProviderSchema,
  RelationTypeSchema,
  SessionRoleSchema,
  SessionStatusSchema,
  TaskStatusSchema,
  UpdateTaskInputSchema,
  type Artifact,
  type CreateArtifactInput,
  type CreateProjectInput,
  type CreateRelationInput,
  type CreateSessionInput,
  type CreateTaskInput,
  type EntityType,
  type Project,
  type Relation,
  type ProjectSession,
  type Session,
  type SessionAssignment,
  type Task,
  type TaskEvent,
  type TaskSession,
  type UpdateTaskInput,
} from "@workdeck/domain";

type SqliteDatabase = InstanceType<typeof Database>;

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  task_count?: number;
}

interface TaskRow {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  goal: string;
  architecture_notes: string;
  review_context: string;
  acceptance_criteria: string;
  constraints: string;
  next_step: string;
  status: Task["status"];
  priority: Task["priority"];
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  project_id: string;
  name: string;
  provider: Session["provider"];
  status: Session["status"];
  external_ref: string | null;
  external_url: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskSessionRow extends SessionRow {
  assignment_task_id: string;
  assignment_role: TaskSession["role"];
  assignment_created_at: string;
  assignment_updated_at: string;
}

interface SessionAssignmentRow {
  task_id: string;
  session_id: string;
  role: SessionAssignment["role"];
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  id: string;
  project_id: string;
  type: Artifact["type"];
  title: string;
  external_ref: string | null;
  external_url: string | null;
  metadata_json: string;
  created_at: string;
}

interface RelationRow {
  id: string;
  source_type: Relation["sourceType"];
  source_id: string;
  target_type: Relation["targetType"];
  target_id: string;
  relation_type: Relation["relationType"];
  metadata_json: string | null;
  created_at: string;
}

interface TaskEventRow {
  id: string;
  task_id: string;
  event_type: TaskEvent["eventType"];
  payload_json: string;
  created_at: string;
}

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('backlog', 'designing', 'implementing', 'reviewing', 'blocked', 'done')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt', 'codex', 'claude', 'local', 'other')),
  role TEXT NOT NULL CHECK (role IN ('architect', 'implementer', 'reviewer', 'researcher')),
  status TEXT NOT NULL CHECK (status IN ('active', 'waiting', 'completed', 'failed', 'archived')),
  external_ref TEXT,
  external_url TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('commit', 'pull_request', 'file', 'report', 'test_run', 'other')),
  title TEXT NOT NULL,
  external_ref TEXT,
  external_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('project', 'task', 'session', 'artifact')),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('project', 'task', 'session', 'artifact')),
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('implements', 'reviews', 'continues', 'depends_on', 'blocks', 'produces', 'fixes', 'derived_from', 'defines')),
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source_type, source_id, target_type, target_id, relation_type)
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('task_created', 'status_changed', 'session_linked', 'artifact_attached', 'relation_created')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_project_task ON sessions(project_id, task_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_project_created ON artifacts(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS cleanup_relations_after_project_delete
AFTER DELETE ON projects
BEGIN
  DELETE FROM relations
  WHERE (source_type = 'project' AND source_id = OLD.id)
     OR (target_type = 'project' AND target_id = OLD.id);
END;

CREATE TRIGGER IF NOT EXISTS cleanup_relations_after_task_delete
AFTER DELETE ON tasks
BEGIN
  DELETE FROM relations
  WHERE (source_type = 'task' AND source_id = OLD.id)
     OR (target_type = 'task' AND target_id = OLD.id);
END;

CREATE TRIGGER IF NOT EXISTS cleanup_relations_after_session_delete
AFTER DELETE ON sessions
BEGIN
  DELETE FROM relations
  WHERE (source_type = 'session' AND source_id = OLD.id)
     OR (target_type = 'session' AND target_id = OLD.id);
END;

CREATE TRIGGER IF NOT EXISTS cleanup_relations_after_artifact_delete
AFTER DELETE ON artifacts
BEGIN
  DELETE FROM relations
  WHERE (source_type = 'artifact' AND source_id = OLD.id)
     OR (target_type = 'artifact' AND target_id = OLD.id);
END;
`;

const MIGRATION_002 = `
ALTER TABLE tasks ADD COLUMN goal TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN architecture_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN review_context TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN constraints TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN next_step TEXT NOT NULL DEFAULT '';

CREATE TEMP TABLE legacy_session_assignments AS
SELECT id AS session_id, task_id, role, created_at, updated_at
FROM sessions
WHERE task_id IS NOT NULL;

DROP TRIGGER IF EXISTS cleanup_relations_after_session_delete;

CREATE TABLE sessions_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt', 'codex', 'claude', 'local', 'other')),
  status TEXT NOT NULL CHECK (status IN ('active', 'waiting', 'completed', 'failed', 'archived')),
  external_ref TEXT,
  external_url TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO sessions_v2 (id, project_id, name, provider, status, external_ref, external_url, summary, created_at, updated_at)
SELECT id, project_id, name, provider, status, external_ref, external_url, summary, created_at, updated_at
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_v2 RENAME TO sessions;

CREATE TABLE task_sessions (
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('architect', 'implementer', 'reviewer', 'researcher')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, session_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

INSERT INTO task_sessions (task_id, session_id, role, created_at, updated_at)
SELECT task_id, session_id, role, created_at, updated_at
FROM legacy_session_assignments;

DROP TABLE legacy_session_assignments;

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_sessions_task ON task_sessions(task_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_sessions_session ON task_sessions(session_id, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS cleanup_relations_after_session_delete
AFTER DELETE ON sessions
BEGIN
  DELETE FROM relations
  WHERE (source_type = 'session' AND source_id = OLD.id)
     OR (target_type = 'session' AND target_id = OLD.id);
END;
`;

const now = () => new Date().toISOString();

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toProject(row: ProjectRow): Project & { taskCount?: number } {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.task_count === undefined ? {} : { taskCount: row.task_count }),
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    description: row.description,
    goal: row.goal,
    architectureNotes: row.architecture_notes,
    reviewContext: row.review_context,
    acceptanceCriteria: row.acceptance_criteria,
    constraints: row.constraints,
    nextStep: row.next_step,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    externalRef: row.external_ref,
    externalUrl: row.external_url,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTaskSession(row: TaskSessionRow): TaskSession {
  return {
    ...toSession(row),
    taskId: row.assignment_task_id,
    role: row.assignment_role,
    assignmentCreatedAt: row.assignment_created_at,
    assignmentUpdatedAt: row.assignment_updated_at,
  };
}

function toSessionAssignment(row: SessionAssignmentRow): SessionAssignment {
  return {
    taskId: row.task_id,
    sessionId: row.session_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    externalRef: row.external_ref,
    externalUrl: row.external_url,
    metadata: parseRecord(row.metadata_json),
    createdAt: row.created_at,
  };
}

function toRelation(row: RelationRow): Relation {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    relationType: row.relation_type,
    metadata: row.metadata_json ? parseRecord(row.metadata_json) : null,
    createdAt: row.created_at,
  };
}

function toTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    payload: parseRecord(row.payload_json),
    createdAt: row.created_at,
  };
}

export class WorkDeckDatabase {
  readonly filePath: string;
  private readonly sqlite: SqliteDatabase;

  constructor(filePath = process.env.WORKDECK_DB_PATH ?? join(process.cwd(), "data", "workdeck.db")) {
    this.filePath = filePath;
    if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
    this.sqlite = new Database(filePath);
    this.sqlite.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.sqlite.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)");
    const applied = new Set(
      (this.sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map(
        (row) => row.version,
      ),
    );
    if (!applied.has(1)) {
      const migrate = this.sqlite.transaction(() => {
        this.sqlite.exec(MIGRATION_001);
        this.sqlite.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(now());
      });
      migrate();
    }
    if (!applied.has(2)) {
      const harden = this.sqlite.transaction(() => {
        this.sqlite.exec(MIGRATION_002);
        this.sqlite.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)").run(now());
      });
      harden();
    }
  }

  close() {
    this.sqlite.close();
  }

  get isForeignKeysEnabled() {
    return (this.sqlite.pragma("foreign_keys", { simple: true }) as number) === 1;
  }

  get migrationVersions(): number[] {
    return (this.sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map(
      (row) => row.version,
    );
  }

  listProjects(): Array<Project & { taskCount: number }> {
    const rows = this.sqlite
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
         FROM projects p ORDER BY p.updated_at DESC, p.created_at DESC`,
      )
      .all() as ProjectRow[];
    return rows.map((row) => toProject(row) as Project & { taskCount: number });
  }

  getProject(id: string): Project | null {
    const row = this.sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  createProject(input: CreateProjectInput, id = randomUUID()): Project {
    const parsed = CreateProjectInputSchema.parse(input);
    const timestamp = now();
    this.sqlite
      .prepare("INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, parsed.name, parsed.description, timestamp, timestamp);
    return this.getProject(id)!;
  }

  deleteProject(id: string) {
    const result = this.sqlite.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (!result.changes) throw new NotFoundError(`Project ${id} was not found`);
  }

  listTasks(projectId: string): Task[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'implementing' THEN 1 WHEN 'reviewing' THEN 2 ELSE 3 END, updated_at DESC")
      .all(projectId) as TaskRow[];
    return rows.map(toTask);
  }

  getTask(id: string): Task | null {
    const row = this.sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  createTask(input: CreateTaskInput, id = randomUUID()): Task {
    const parsed = CreateTaskInputSchema.parse(input);
    this.assertProject(parsed.projectId);
    if (parsed.parentTaskId) {
      const parent = this.assertTask(parsed.parentTaskId);
      if (parent.projectId !== parsed.projectId) throw new DomainError("Parent task must belong to the same project");
      if (parent.id === id) throw new DomainError("A task cannot be its own parent");
      this.assertNoParentCycle(id, parsed.parentTaskId);
    }
    const timestamp = now();
    const insert = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO tasks (id, project_id, parent_task_id, title, description, goal, architecture_notes, review_context, acceptance_criteria, constraints, next_step, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          parsed.projectId,
          parsed.parentTaskId ?? null,
          parsed.title,
          parsed.description,
          parsed.goal,
          parsed.architectureNotes,
          parsed.reviewContext,
          parsed.acceptanceCriteria,
          parsed.constraints,
          parsed.nextStep,
          parsed.status,
          parsed.priority,
          timestamp,
          timestamp,
        );
      this.recordEvent(id, "task_created", { title: parsed.title, status: parsed.status, priority: parsed.priority });
    });
    insert();
    return this.getTask(id)!;
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    const current = this.assertTask(id);
    const parsed = UpdateTaskInputSchema.parse(input);
    if (parsed.parentTaskId) {
      const parent = this.assertTask(parsed.parentTaskId);
      if (parent.projectId !== current.projectId) throw new DomainError("Parent task must belong to the same project");
      if (parent.id === id) throw new DomainError("A task cannot be its own parent");
      this.assertNoParentCycle(id, parsed.parentTaskId);
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    if (parsed.title !== undefined) {
      fields.push("title = ?");
      values.push(parsed.title);
    }
    if (parsed.description !== undefined) {
      fields.push("description = ?");
      values.push(parsed.description);
    }
    if (parsed.goal !== undefined) {
      fields.push("goal = ?");
      values.push(parsed.goal);
    }
    if (parsed.architectureNotes !== undefined) {
      fields.push("architecture_notes = ?");
      values.push(parsed.architectureNotes);
    }
    if (parsed.reviewContext !== undefined) {
      fields.push("review_context = ?");
      values.push(parsed.reviewContext);
    }
    if (parsed.acceptanceCriteria !== undefined) {
      fields.push("acceptance_criteria = ?");
      values.push(parsed.acceptanceCriteria);
    }
    if (parsed.constraints !== undefined) {
      fields.push("constraints = ?");
      values.push(parsed.constraints);
    }
    if (parsed.nextStep !== undefined) {
      fields.push("next_step = ?");
      values.push(parsed.nextStep);
    }
    if (parsed.status !== undefined) {
      fields.push("status = ?");
      values.push(parsed.status);
    }
    if (parsed.priority !== undefined) {
      fields.push("priority = ?");
      values.push(parsed.priority);
    }
    if (parsed.parentTaskId !== undefined) {
      fields.push("parent_task_id = ?");
      values.push(parsed.parentTaskId ?? null);
    }
    fields.push("updated_at = ?");
    values.push(now(), id);

    const update = this.sqlite.transaction(() => {
      this.sqlite.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      if (parsed.status && parsed.status !== current.status) {
        this.recordEvent(id, "status_changed", { from: current.status, to: parsed.status });
      }
    });
    update();
    return this.getTask(id)!;
  }

  deleteTask(id: string) {
    const result = this.sqlite.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    if (!result.changes) throw new NotFoundError(`Task ${id} was not found`);
  }

  listSessionsForProject(projectId: string): ProjectSession[] {
    const rows = this.sqlite.prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as SessionRow[];
    return rows.map((row) => ({ ...toSession(row), assignments: this.listAssignmentsForSession(row.id) }));
  }

  listSessionsForTask(taskId: string): TaskSession[] {
    this.assertTask(taskId);
    const rows = this.sqlite
      .prepare(
        `SELECT s.*,
                ts.task_id AS assignment_task_id,
                ts.role AS assignment_role,
                ts.created_at AS assignment_created_at,
                ts.updated_at AS assignment_updated_at
         FROM sessions s
         JOIN task_sessions ts ON ts.session_id = s.id
         WHERE ts.task_id = ?
         ORDER BY CASE ts.role WHEN 'architect' THEN 0 WHEN 'implementer' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END, ts.updated_at DESC`,
      )
      .all(taskId) as TaskSessionRow[];
    return rows.map(toTaskSession);
  }

  getSession(id: string): Session | null {
    const row = this.sqlite.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  getTaskSession(taskId: string, sessionId: string): TaskSession | null {
    const row = this.sqlite
      .prepare(
        `SELECT s.*,
                ts.task_id AS assignment_task_id,
                ts.role AS assignment_role,
                ts.created_at AS assignment_created_at,
                ts.updated_at AS assignment_updated_at
         FROM sessions s
         JOIN task_sessions ts ON ts.session_id = s.id
         WHERE ts.task_id = ? AND ts.session_id = ?`,
      )
      .get(taskId, sessionId) as TaskSessionRow | undefined;
    return row ? toTaskSession(row) : null;
  }

  createSession(input: CreateSessionInput, id = randomUUID()): Session {
    const parsed = CreateSessionInputSchema.parse(input);
    const project = this.assertProject(parsed.projectId);
    if (parsed.taskId) {
      const task = this.assertTask(parsed.taskId);
      if (task.projectId !== project.id) throw new DomainError("Session task must belong to the same project");
    }
    const timestamp = now();
    const create = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO sessions (id, project_id, name, provider, status, external_ref, external_url, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, parsed.projectId, parsed.name, parsed.provider, parsed.status, parsed.externalRef ?? null, parsed.externalUrl ?? null, parsed.summary ?? null, timestamp, timestamp);
      if (parsed.taskId) this.assignSessionToTaskWithinTransaction(id, parsed.taskId, parsed.role, timestamp);
    });
    create();
    return this.getSession(id)!;
  }

  linkSessionToTask(sessionId: string, taskId: string, role: TaskSession["role"] = "implementer"): TaskSession {
    const session = this.assertSession(sessionId);
    const task = this.assertTask(taskId);
    if (session.projectId !== task.projectId) throw new DomainError("Session and task must belong to the same project");
    const parsedRole = SessionRoleSchema.parse(role);
    const update = this.sqlite.transaction(() => {
      this.assignSessionToTaskWithinTransaction(sessionId, taskId, parsedRole, now());
    });
    update();
    return this.getTaskSession(taskId, sessionId)!;
  }

  listArtifactsForProject(projectId: string): Artifact[] {
    const rows = this.sqlite.prepare("SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  listArtifactsForTask(taskId: string): Artifact[] {
    const task = this.assertTask(taskId);
    const rows = this.sqlite
      .prepare(
        `SELECT DISTINCT a.*
         FROM artifacts a
         JOIN relations r ON r.target_type = 'artifact' AND r.target_id = a.id
         WHERE a.project_id = ?
           AND ((r.source_type = 'task' AND r.source_id = ?)
             OR (r.source_type = 'session' AND EXISTS (
               SELECT 1 FROM task_sessions ts WHERE ts.session_id = r.source_id AND ts.task_id = ?
             )))
         ORDER BY a.created_at DESC`,
      )
      .all(task.projectId, taskId, taskId) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  getArtifact(id: string): Artifact | null {
    const row = this.sqlite.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
    return row ? toArtifact(row) : null;
  }

  createArtifact(input: CreateArtifactInput, id = randomUUID()): Artifact {
    const parsed = CreateArtifactInputSchema.parse(input);
    this.assertProject(parsed.projectId);
    this.sqlite
      .prepare(
        "INSERT INTO artifacts (id, project_id, type, title, external_ref, external_url, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, parsed.projectId, parsed.type, parsed.title, parsed.externalRef ?? null, parsed.externalUrl ?? null, JSON.stringify(parsed.metadata), now());
    return this.getArtifact(id)!;
  }

  attachArtifactToTask(taskId: string, artifactId: string): Artifact {
    const task = this.assertTask(taskId);
    const artifact = this.assertArtifact(artifactId);
    if (task.projectId !== artifact.projectId) throw new DomainError("Artifact and task must belong to the same project");
    const timestamp = now();
    const attach = this.sqlite.transaction(() => {
      const result = this.sqlite
        .prepare(
          "INSERT OR IGNORE INTO relations (id, source_type, source_id, target_type, target_id, relation_type, metadata_json, created_at) VALUES (?, 'task', ?, 'artifact', ?, 'produces', NULL, ?)",
        )
        .run(randomUUID(), taskId, artifactId, timestamp);
      if (result.changes) {
        this.sqlite.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(timestamp, taskId);
        this.recordEvent(taskId, "artifact_attached", { artifactId, artifactTitle: artifact.title });
      }
    });
    attach();
    return artifact;
  }

  createArtifactForTask(taskId: string, input: Omit<CreateArtifactInput, "projectId">, artifactId = randomUUID()): Artifact {
    const task = this.assertTask(taskId);
    const create = this.sqlite.transaction(() => {
      const artifact = this.createArtifact({ ...input, projectId: task.projectId }, artifactId);
      this.attachArtifactToTask(taskId, artifact.id);
      return artifact;
    });
    return create();
  }

  listRelationsForEntity(type: EntityType, id: string): Relation[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM relations WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?) ORDER BY created_at DESC")
      .all(type, id, type, id) as RelationRow[];
    return rows.map(toRelation);
  }

  createRelation(input: CreateRelationInput, id = randomUUID()): Relation {
    const parsed = CreateRelationInputSchema.parse(input);
    if (parsed.sourceType === parsed.targetType && parsed.sourceId === parsed.targetId) {
      throw new DomainError("An entity cannot relate to itself");
    }
    const sourceProjectId = this.entityProjectId(parsed.sourceType, parsed.sourceId);
    const targetProjectId = this.entityProjectId(parsed.targetType, parsed.targetId);
    if (sourceProjectId !== targetProjectId) throw new DomainError("Relation entities must belong to the same project");
    const timestamp = now();
    const insert = this.sqlite.prepare(
      "INSERT OR IGNORE INTO relations (id, source_type, source_id, target_type, target_id, relation_type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const result = insert.run(id, parsed.sourceType, parsed.sourceId, parsed.targetType, parsed.targetId, parsed.relationType, parsed.metadata ? JSON.stringify(parsed.metadata) : null, timestamp);
    const row = this.sqlite
      .prepare("SELECT * FROM relations WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relation_type = ?")
      .get(parsed.sourceType, parsed.sourceId, parsed.targetType, parsed.targetId, parsed.relationType) as RelationRow;
    const relation = toRelation(row);
    if (result.changes) {
      const taskIds = new Set<string>();
      if (parsed.sourceType === "task") taskIds.add(parsed.sourceId);
      if (parsed.targetType === "task") taskIds.add(parsed.targetId);
      if (parsed.sourceType === "session") this.taskIdsForSession(parsed.sourceId).forEach((taskId) => taskIds.add(taskId));
      if (parsed.targetType === "session") this.taskIdsForSession(parsed.targetId).forEach((taskId) => taskIds.add(taskId));
      if (parsed.sourceType === "artifact") this.taskIdsForArtifact(parsed.sourceId).forEach((taskId) => taskIds.add(taskId));
      if (parsed.targetType === "artifact") this.taskIdsForArtifact(parsed.targetId).forEach((taskId) => taskIds.add(taskId));
      for (const taskId of taskIds) {
        this.sqlite.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(timestamp, taskId);
        this.recordEvent(taskId, "relation_created", { relationId: relation.id, relationType: relation.relationType, sourceType: relation.sourceType, sourceId: relation.sourceId, targetType: relation.targetType, targetId: relation.targetId });
      }
    }
    return relation;
  }

  listTaskEvents(taskId: string): TaskEvent[] {
    const rows = this.sqlite.prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as TaskEventRow[];
    return rows.map(toTaskEvent);
  }

  getEntity(type: EntityType, id: string): Project | Task | Session | Artifact | null {
    if (type === "project") return this.getProject(id);
    if (type === "task") return this.getTask(id);
    if (type === "session") return this.getSession(id);
    return this.getArtifact(id);
  }

  seedDemo() {
    const existing = this.sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    if (existing.count > 0) {
      this.backfillDemoContext();
      return false;
    }
    const timestamp = now();
    const earlier = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const seed = this.sqlite.transaction(() => {
      this.sqlite.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?)").run("project-agentdeck", "AgentDeck", "A multi-session runtime with a task-centric delivery path.", earlier(180), timestamp);
      const taskInsert = this.sqlite.prepare("INSERT INTO tasks (id, project_id, parent_task_id, title, description, goal, architecture_notes, review_context, acceptance_criteria, constraints, next_step, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      taskInsert.run("task-phase-2a", "project-agentdeck", null, "Phase 2A · Core Runtime", "Stabilize the runtime primitives and state transitions.", "Deliver a deterministic runtime foundation for later sessions.", "Keep protocol, core and node boundaries independent.", "No open review findings recorded.", "Core state transitions remain deterministic and covered by tests.", "Do not introduce provider SDKs into domain code.", "Use the stable runtime as the base for daemon work.", "done", "high", earlier(175), earlier(120));
      taskInsert.run("task-phase-2b", "project-agentdeck", null, "Phase 2B · Daemon", "Ship the local daemon and lifecycle hooks.", "Make the runtime usable as a long-running local process.", "Lifecycle transitions must pass through the same event ingress as metrics.", "Shutdown and lifecycle behavior were reviewed before completion.", "Daemon starts, reports lifecycle events and exits cleanly.", "Keep the daemon local-first and avoid cloud state.", "Use the daemon contract as the input to NetworkSession.", "done", "medium", earlier(170), earlier(90));
      taskInsert.run("task-phase-2c", "project-agentdeck", null, "Phase 2C · NetworkSession", "Implement the provider-neutral network session boundary and reconnect behavior.", "Provide an authenticated, durable session boundary that can be handed between future adapters.", "The core must remain provider-neutral; session identity, transport and reducer ingress stay separate.", "Review identified reconnect edge cases that need a hardening pass.", "Session lease, authentication and reconnect behavior have regression coverage.", "Do not add GitHub, ChatGPT or Claude connectors in this phase.", "Resolve the hardening task, then re-run the full verification matrix.", "implementing", "critical", earlier(165), earlier(6));
      taskInsert.run("task-phase-2c-hardening", "project-agentdeck", "task-phase-2c", "Phase 2C · Hardening", "Address review findings and add regression coverage before handoff.", "Close the review findings that block a safe Phase 2C handoff.", "Prefer narrow fixes at the session boundary over changes to the provider-neutral domain.", "Independent review flagged reconnect edge cases around session recovery.", "Every review finding has a regression test and the full suite is green.", "Preserve the wire protocol and do not hide failures behind retries.", "Add the missing regression cases and move Phase 2C back to review.", "blocked", "high", earlier(10), earlier(3));
      const sessionInsert = this.sqlite.prepare("INSERT INTO sessions (id, project_id, name, provider, status, external_ref, external_url, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      sessionInsert.run("session-architecture", "project-agentdeck", "Architecture Chat", "chatgpt", "completed", null, null, "Defined the session boundary and the handoff contract.", earlier(150), earlier(60));
      sessionInsert.run("session-codex-2c", "project-agentdeck", "Codex Phase 2C", "codex", "active", "codex-phase-2c", null, "Implementing the reconnect path and persistence hooks.", earlier(140), earlier(6));
      sessionInsert.run("session-independent-review", "project-agentdeck", "Independent Review Chat", "chatgpt", "waiting", null, null, "Review surfaced hardening work around reconnect edge cases.", earlier(50), earlier(3));
      const assignmentInsert = this.sqlite.prepare("INSERT INTO task_sessions (task_id, session_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
      assignmentInsert.run("task-phase-2c", "session-architecture", "architect", earlier(150), earlier(60));
      assignmentInsert.run("task-phase-2c", "session-codex-2c", "implementer", earlier(140), earlier(6));
      assignmentInsert.run("task-phase-2c", "session-independent-review", "reviewer", earlier(50), earlier(3));
      const artifactInsert = this.sqlite.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      artifactInsert.run("artifact-ec565d5", "project-agentdeck", "commit", "ec565d5 · NetworkSession baseline", "ec565d5", null, JSON.stringify({ branch: "phase-2c", tests: "42 passed" }), earlier(8));
      artifactInsert.run("artifact-review-report", "project-agentdeck", "report", "Independent review · reconnect edge cases", null, null, JSON.stringify({ severity: "medium" }), earlier(3));
      const relationInsert = this.sqlite.prepare("INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      relationInsert.run("relation-architecture-defines", "session", "session-architecture", "task", "task-phase-2c", "defines", null, earlier(60));
      relationInsert.run("relation-codex-implements", "session", "session-codex-2c", "task", "task-phase-2c", "implements", null, earlier(6));
      relationInsert.run("relation-codex-produces", "session", "session-codex-2c", "artifact", "artifact-ec565d5", "produces", null, earlier(8));
      relationInsert.run("relation-review-reviews", "session", "session-independent-review", "artifact", "artifact-ec565d5", "reviews", null, earlier(3));
      relationInsert.run("relation-hardening-fixes", "task", "task-phase-2c-hardening", "task", "task-phase-2c", "fixes", null, earlier(3));
      relationInsert.run("relation-2c-depends-2b", "task", "task-phase-2c", "task", "task-phase-2b", "depends_on", null, earlier(6));
      const eventInsert = this.sqlite.prepare("INSERT INTO task_events VALUES (?, ?, ?, ?, ?)");
      eventInsert.run(randomUUID(), "task-phase-2a", "task_created", JSON.stringify({ title: "Phase 2A · Core Runtime", seeded: true }), earlier(175));
      eventInsert.run(randomUUID(), "task-phase-2b", "task_created", JSON.stringify({ title: "Phase 2B · Daemon", seeded: true }), earlier(170));
      eventInsert.run(randomUUID(), "task-phase-2c", "task_created", JSON.stringify({ title: "Phase 2C · NetworkSession", seeded: true }), earlier(165));
      eventInsert.run(randomUUID(), "task-phase-2c", "session_linked", JSON.stringify({ sessionId: "session-codex-2c", seeded: true }), earlier(140));
      eventInsert.run(randomUUID(), "task-phase-2c", "artifact_attached", JSON.stringify({ artifactId: "artifact-ec565d5", seeded: true }), earlier(8));
      eventInsert.run(randomUUID(), "task-phase-2c-hardening", "task_created", JSON.stringify({ title: "Phase 2C · Hardening", seeded: true }), earlier(10));
    });
    seed();
    return true;
  }

  private backfillDemoContext() {
    const updates: Array<[string, string, string, string, string, string, string]> = [
      [
        "task-phase-2a",
        "Deliver a deterministic runtime foundation for later sessions.",
        "Keep protocol, core and node boundaries independent.",
        "No open review findings recorded.",
        "Core state transitions remain deterministic and covered by tests.",
        "Do not introduce provider SDKs into domain code.",
        "Use the stable runtime as the base for daemon work.",
      ],
      [
        "task-phase-2b",
        "Make the runtime usable as a long-running local process.",
        "Lifecycle transitions must pass through the same event ingress as metrics.",
        "Shutdown and lifecycle behavior were reviewed before completion.",
        "Daemon starts, reports lifecycle events and exits cleanly.",
        "Keep the daemon local-first and avoid cloud state.",
        "Use the daemon contract as the input to NetworkSession.",
      ],
      [
        "task-phase-2c",
        "Provide an authenticated, durable session boundary that can be handed between future adapters.",
        "The core must remain provider-neutral; session identity, transport and reducer ingress stay separate.",
        "Review identified reconnect edge cases that need a hardening pass.",
        "Session lease, authentication and reconnect behavior have regression coverage.",
        "Do not add GitHub, ChatGPT or Claude connectors in this phase.",
        "Resolve the hardening task, then re-run the full verification matrix.",
      ],
      [
        "task-phase-2c-hardening",
        "Close the review findings that block a safe Phase 2C handoff.",
        "Prefer narrow fixes at the session boundary over changes to the provider-neutral domain.",
        "Independent review flagged reconnect edge cases around session recovery.",
        "Every review finding has a regression test and the full suite is green.",
        "Preserve the wire protocol and do not hide failures behind retries.",
        "Add the missing regression cases and move Phase 2C back to review.",
      ],
    ];
    const update = this.sqlite.prepare("UPDATE tasks SET goal = ?, architecture_notes = ?, review_context = ?, acceptance_criteria = ?, constraints = ?, next_step = ? WHERE id = ? AND goal = ''");
    const backfill = this.sqlite.transaction(() => {
      for (const [id, goal, architectureNotes, reviewContext, acceptanceCriteria, constraints, nextStep] of updates) {
        update.run(goal, architectureNotes, reviewContext, acceptanceCriteria, constraints, nextStep, id);
      }
    });
    backfill();
  }

  private listAssignmentsForSession(sessionId: string): SessionAssignment[] {
    const rows = this.sqlite
      .prepare("SELECT task_id, session_id, role, created_at, updated_at FROM task_sessions WHERE session_id = ? ORDER BY updated_at DESC")
      .all(sessionId) as SessionAssignmentRow[];
    return rows.map(toSessionAssignment);
  }

  private assignSessionToTaskWithinTransaction(sessionId: string, taskId: string, role: TaskSession["role"], timestamp: string) {
    const existing = this.sqlite
      .prepare("SELECT role FROM task_sessions WHERE task_id = ? AND session_id = ?")
      .get(taskId, sessionId) as { role: TaskSession["role"] } | undefined;
    if (existing?.role === role) return false;

    if (existing) {
      this.sqlite
        .prepare("UPDATE task_sessions SET role = ?, updated_at = ? WHERE task_id = ? AND session_id = ?")
        .run(role, timestamp, taskId, sessionId);
    } else {
      this.sqlite
        .prepare("INSERT INTO task_sessions (task_id, session_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(taskId, sessionId, role, timestamp, timestamp);
    }
    this.sqlite.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(timestamp, sessionId);
    this.sqlite.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(timestamp, taskId);
    this.recordEvent(taskId, "session_linked", {
      sessionId,
      role,
      previousRole: existing?.role ?? null,
    });
    return true;
  }

  private taskIdsForSession(sessionId: string): string[] {
    const rows = this.sqlite.prepare("SELECT task_id FROM task_sessions WHERE session_id = ?").all(sessionId) as Array<{ task_id: string }>;
    return rows.map((row) => row.task_id);
  }

  private taskIdsForArtifact(artifactId: string): string[] {
    const rows = this.sqlite
      .prepare(
        `SELECT source_id AS task_id
         FROM relations
         WHERE source_type = 'task' AND target_type = 'artifact' AND target_id = ?
         UNION
         SELECT target_id AS task_id
         FROM relations
         WHERE source_type = 'artifact' AND target_type = 'task' AND source_id = ?`,
      )
      .all(artifactId, artifactId) as Array<{ task_id: string }>;
    return rows.map((row) => row.task_id);
  }

  private recordEvent(taskId: string, eventType: TaskEvent["eventType"], payload: Record<string, unknown>) {
    this.sqlite.prepare("INSERT INTO task_events (id, task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), taskId, eventType, JSON.stringify(payload), now());
  }

  private assertNoParentCycle(taskId: string, parentTaskId: string) {
    const cycle = this.sqlite
      .prepare(
        `WITH RECURSIVE ancestors(id, path) AS (
           SELECT ? AS id, '|' || ? || '|' AS path
           UNION ALL
           SELECT t.parent_task_id, ancestors.path || t.parent_task_id || '|'
           FROM tasks t
           JOIN ancestors ON t.id = ancestors.id
           WHERE t.parent_task_id IS NOT NULL
             AND instr(ancestors.path, '|' || t.parent_task_id || '|') = 0
         )
         SELECT 1 AS cycle
         FROM ancestors
         WHERE id = ?
         LIMIT 1`,
      )
      .get(parentTaskId, parentTaskId, taskId) as { cycle: number } | undefined;
    if (cycle) throw new DomainError("Parent task assignment would create a cycle");
  }

  private assertProject(id: string): Project {
    const project = this.getProject(id);
    if (!project) throw new NotFoundError(`Project ${id} was not found`);
    return project;
  }

  private assertTask(id: string): Task {
    const task = this.getTask(id);
    if (!task) throw new NotFoundError(`Task ${id} was not found`);
    return task;
  }

  private assertSession(id: string): Session {
    const session = this.getSession(id);
    if (!session) throw new NotFoundError(`Session ${id} was not found`);
    return session;
  }

  private assertArtifact(id: string): Artifact {
    const artifact = this.getArtifact(id);
    if (!artifact) throw new NotFoundError(`Artifact ${id} was not found`);
    return artifact;
  }

  private entityProjectId(type: EntityType, id: string): string {
    const entity = this.getEntity(type, id);
    if (!entity) throw new NotFoundError(`${type} ${id} was not found`);
    if (type === "project") return entity.id;
    return (entity as Task | Session | Artifact).projectId;
  }
}

export const validationSchemas = {
  ArtifactTypeSchema,
  PrioritySchema,
  ProviderSchema,
  RelationTypeSchema,
  SessionRoleSchema,
  SessionStatusSchema,
  TaskStatusSchema,
};
