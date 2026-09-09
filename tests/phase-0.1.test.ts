import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { WorkDeckService } from "@workdeck/api";
import { WorkDeckDatabase } from "@workdeck/db";

function withDatabase(run: (database: WorkDeckDatabase, filePath: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "workdeck-test-"));
  const filePath = join(directory, "test.db");
  const database = new WorkDeckDatabase(filePath);
  try {
    run(database, filePath);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("WorkDeck Phase 0.1 domain and persistence", () => {
  it("creates a project, parent task and child task with valid enums", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Control plane", description: "Test project" });
      const parent = database.createTask({ projectId: project.id, title: "Define model", status: "designing", priority: "high" });
      const child = database.createTask({ projectId: project.id, parentTaskId: parent.id, title: "Define relation", status: "backlog", priority: "medium" });

      expect(child.parentTaskId).toBe(parent.id);
      expect(database.listTasks(project.id)).toHaveLength(2);
      expect(() => database.createTask({ projectId: project.id, title: "Bad status", status: "not-a-status" as never })).toThrow();
      expect(() => database.createTask({ projectId: project.id, title: "Bad priority", priority: "urgent" as never })).toThrow();
    });
  });

  it("rejects invalid session roles and invalid relation entities", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Validation" });
      const task = database.createTask({ projectId: project.id, title: "Task" });
      const session = database.createSession({ projectId: project.id, name: "Bad role" });
      expect(() => database.assignSessionToTask({ taskId: task.id, sessionId: session.id, role: "operator" as never })).toThrow();
      expect(() => database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "artifact", targetId: "missing", relationType: "produces" })).toThrow(/not found/);
      expect(() => database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "task", targetId: task.id, relationType: "depends_on" })).toThrow(/itself/);
      expect(() => database.createRelation({ sourceType: "artifact", sourceId: "missing", targetType: "session", targetId: session.id, relationType: "produces" })).toThrow(/does not allow/);
    });
  });

  it("records task events for create, status change, links, artifacts and relations", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Events" });
      const task = database.createTask({ projectId: project.id, title: "Trace events" });
      const session = database.createSession({ projectId: project.id, name: "Implementer", provider: "codex" });
      database.assignSessionToTask({ taskId: task.id, sessionId: session.id, role: "implementer" });
      const artifact = database.createArtifactForTask(task.id, { type: "commit", title: "abc123", externalRef: "abc123" });
      database.updateTask(task.id, { status: "reviewing" });
      database.createRelation({ sourceType: "session", sourceId: session.id, targetType: "artifact", targetId: artifact.id, relationType: "produces" });

      const eventTypes = database.listTaskEvents(task.id).map((event) => event.eventType);
      expect(eventTypes).toEqual(expect.arrayContaining(["task_created", "status_changed", "session_linked", "artifact_attached", "relation_created"]));
    });
  });

  it("keeps the database after reload and cleans polymorphic relations on deletes", () => {
    const directory = mkdtempSync(join(tmpdir(), "workdeck-reload-"));
    const filePath = join(directory, "reload.db");
    try {
      const first = new WorkDeckDatabase(filePath);
      const project = first.createProject({ name: "Durable" });
      const task = first.createTask({ projectId: project.id, title: "Persist me" });
      const artifact = first.createArtifactForTask(task.id, { type: "file", title: "design.md" });
      first.createRelation({ sourceType: "task", sourceId: task.id, targetType: "artifact", targetId: artifact.id, relationType: "derived_from" });
      first.close();

      const second = new WorkDeckDatabase(filePath);
      expect(second.isForeignKeysEnabled).toBe(true);
      expect(second.migrationVersions).toEqual([1, 2, 3, 4]);
      expect(second.getProject(project.id)?.name).toBe("Durable");
      expect(second.getTask(task.id)?.title).toBe("Persist me");
      expect(second.listRelationsForEntity("task", task.id).length).toBeGreaterThan(0);
      second.deleteTask(task.id);
      expect(second.listRelationsForEntity("task", task.id)).toEqual([]);
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders a complete task handoff from the task graph", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Handoff project" });
      const dependency = database.createTask({ projectId: project.id, title: "Dependency", status: "done" });
      const task = database.createTask({
        projectId: project.id,
        title: "Continue delivery",
        description: "Carry the implementation forward.",
        goal: "Deliver the next safe slice.",
        architectureNotes: "Keep the adapter boundary provider-neutral.",
        reviewContext: "P1: add reconnect regression coverage.",
        acceptanceCriteria: "The full suite passes.",
        constraints: "Do not move provider code into domain.",
        nextStep: "Add the regression test and rerun CI.",
        status: "implementing",
        priority: "high",
      });
      database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "task", targetId: dependency.id, relationType: "depends_on" });
      const session = database.createSession({ projectId: project.id, name: "Codex implementer", provider: "codex", summary: "Working on the next slice." });
      database.assignSessionToTask({ taskId: task.id, sessionId: session.id, role: "implementer" });
      const artifact = database.createArtifactForTask(task.id, { type: "commit", title: "abc123", externalRef: "abc123" });
      database.createRelation({ sourceType: "session", sourceId: session.id, targetType: "artifact", targetId: artifact.id, relationType: "produces" });

      const markdown = new WorkDeckService(database).getHandoff(task.id).markdown;
      expect(markdown).toContain("# Handoff project — Continue delivery Handoff");
      expect(markdown).toContain("## Sessions");
      expect(markdown).toContain("Codex implementer");
      expect(markdown).toContain("## Artifacts");
      expect(markdown).toContain("abc123");
      expect(markdown).toContain("## Dependencies");
      expect(markdown).toContain("Dependency");
      expect(markdown).toContain("## Relations");
      expect(markdown).toContain("depends on");
      expect(markdown).toContain("## Key Architecture Decisions");
      expect(markdown).toContain("Keep the adapter boundary provider-neutral.");
      expect(markdown).toContain("## Acceptance Criteria");
      expect(markdown).toContain("The full suite passes.");
      expect(markdown).toContain("## Protected Constraints");
      expect(markdown).toContain("Do not move provider code into domain.");
      expect(markdown).toContain("Add the regression test and rerun CI.");
    });
  });

  it("assigns one long-lived session to multiple tasks with different roles", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Many to many" });
      const designTask = database.createTask({ projectId: project.id, title: "Design phase" });
      const reviewTask = database.createTask({ projectId: project.id, title: "Review phase" });
      const session = database.createSession({ projectId: project.id, name: "Long-lived Chat", provider: "chatgpt", status: "active" });

      database.linkSessionToTask(session.id, designTask.id, "architect");
      database.linkSessionToTask(session.id, reviewTask.id, "reviewer");

      expect(database.listSessionsForTask(designTask.id)[0].role).toBe("architect");
      expect(database.listSessionsForTask(reviewTask.id)[0].role).toBe("reviewer");
      expect(database.listSessionsForProject(project.id)[0].assignments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ taskId: designTask.id, role: "architect" }),
          expect.objectContaining({ taskId: reviewTask.id, role: "reviewer" }),
        ]),
      );
    });
  });

  it("migrates the Phase 0.1 single-task session rows into assignments", () => {
    const directory = mkdtempSync(join(tmpdir(), "workdeck-legacy-"));
    const filePath = join(directory, "legacy.db");
    const legacy = new Database(filePath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-01-01T00:00:00.000Z');
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_task_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT, name TEXT NOT NULL, provider TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, external_ref TEXT, external_url TEXT, summary TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE artifacts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, external_ref TEXT, external_url TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE relations (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, relation_type TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE task_events (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      INSERT INTO projects VALUES ('p', 'Legacy', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO tasks VALUES ('t', 'p', NULL, 'Legacy task', '', 'implementing', 'medium', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO sessions VALUES ('s', 'p', 't', 'Long Chat', 'chatgpt', 'reviewer', 'active', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO artifacts VALUES ('a', 'p', 'commit', 'legacy-commit', 'legacy-commit', NULL, '{}', '2026-01-01T00:00:00.000Z');
      INSERT INTO relations VALUES ('legacy-session-artifact', 'session', 's', 'artifact', 'a', 'produces', NULL, '2026-01-01T00:00:00.000Z');
      INSERT INTO task_events VALUES ('legacy-artifact-event', 't', 'artifact_attached', '{"artifactId":"a"}', '2026-01-01T00:00:00.000Z');
    `);
    legacy.close();
    try {
      const database = new WorkDeckDatabase(filePath);
      expect(database.migrationVersions).toEqual([1, 2, 3, 4]);
      expect(database.getSession("s")).not.toHaveProperty("role");
      expect(database.listSessionsForTask("t")[0]).toEqual(expect.objectContaining({ id: "s", taskId: "t", role: "reviewer" }));
      expect(database.listArtifactsForTask("t")).toEqual(expect.arrayContaining([expect.objectContaining({ id: "a", title: "legacy-commit" })]));
      expect(new WorkDeckService(database).getHandoff("t").markdown).toContain("legacy-commit");
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects parent task cycles through recursive ancestor traversal", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Hierarchy" });
      const first = database.createTask({ projectId: project.id, title: "First" });
      const second = database.createTask({ projectId: project.id, title: "Second", parentTaskId: first.id });
      expect(() => database.updateTask(first.id, { parentTaskId: second.id })).toThrow(/cycle/);
    });
  });

  it("does not create duplicate activity for idempotent links", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Activity" });
      const task = database.createTask({ projectId: project.id, title: "Stable activity" });
      const session = database.createSession({ projectId: project.id, name: "Reviewer", provider: "chatgpt" });
      database.linkSessionToTask(session.id, task.id, "reviewer");
      const afterFirstLink = database.listTaskEvents(task.id).length;
      const firstUpdatedAt = database.getTask(task.id)!.updatedAt;
      database.linkSessionToTask(session.id, task.id, "reviewer");
      expect(database.listTaskEvents(task.id)).toHaveLength(afterFirstLink);
      expect(database.getTask(task.id)!.updatedAt).toBe(firstUpdatedAt);

      const artifact = database.createArtifact({ projectId: project.id, type: "commit", title: "abc" });
      database.attachArtifactToTask(task.id, artifact.id);
      const afterFirstArtifact = database.listTaskEvents(task.id).length;
      database.attachArtifactToTask(task.id, artifact.id);
      expect(database.listTaskEvents(task.id)).toHaveLength(afterFirstArtifact);
      expect(database.listRelationsForEntity("task", task.id).filter((relation) => relation.targetId === artifact.id)).toHaveLength(1);

      database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "artifact", targetId: artifact.id, relationType: "derived_from" });
      const afterFirstRelation = database.listTaskEvents(task.id).length;
      database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "artifact", targetId: artifact.id, relationType: "derived_from" });
      expect(database.listTaskEvents(task.id)).toHaveLength(afterFirstRelation);
    });
  });

  it("isolates Task context across a shared session and keeps relation activity scoped", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Context isolation" });
      const taskA = database.createTask({ projectId: project.id, title: "Task A" });
      const taskB = database.createTask({ projectId: project.id, title: "Task B" });
      const session = database.createSession({ projectId: project.id, name: "Long-lived Chat", provider: "chatgpt" });
      database.assignSessionToTask({ taskId: taskA.id, sessionId: session.id, role: "architect" });
      database.assignSessionToTask({ taskId: taskB.id, sessionId: session.id, role: "reviewer" });
      const artifactA = database.createArtifactForTask(taskA.id, { type: "commit", title: "commit-A" });
      const artifactB = database.createArtifactForTask(taskB.id, { type: "commit", title: "commit-B" });

      const eventsBeforeA = database.listTaskEvents(taskA.id).length;
      const eventsBeforeB = database.listTaskEvents(taskB.id).length;
      const relationA = database.createRelation({ sourceType: "session", sourceId: session.id, targetType: "artifact", targetId: artifactA.id, relationType: "reviews" });

      expect(database.listArtifactsForTask(taskA.id).map((artifact) => artifact.title)).toEqual(["commit-A"]);
      expect(database.listArtifactsForTask(taskB.id).map((artifact) => artifact.title)).toEqual(["commit-B"]);
      expect(database.listTaskEvents(taskA.id)).toHaveLength(eventsBeforeA + 1);
      expect(database.listTaskEvents(taskA.id).some((event) => event.eventType === "relation_created" && event.payload.relationId === relationA.id)).toBe(true);
      expect(database.listTaskEvents(taskB.id)).toHaveLength(eventsBeforeB);

      const service = new WorkDeckService(database);
      const detailA = service.getTaskDetail(taskA.id);
      const detailB = service.getTaskDetail(taskB.id);
      expect(detailA.artifacts.map((artifact) => artifact.title)).toEqual(["commit-A"]);
      expect(detailB.artifacts.map((artifact) => artifact.title)).toEqual(["commit-B"]);
      expect(detailA.relations.map((relation) => relation.id)).toContain(relationA.id);
      expect(detailB.relations.map((relation) => relation.id)).not.toContain(relationA.id);
      expect(service.getHandoff(taskA.id).markdown).toContain("commit-A");
      expect(service.getHandoff(taskA.id).markdown).not.toContain("commit-B");
      expect(service.getHandoff(taskB.id).markdown).toContain("commit-B");
      expect(service.getHandoff(taskB.id).markdown).not.toContain("commit-A");

      database.createRelation({ sourceType: "session", sourceId: session.id, targetType: "artifact", targetId: artifactB.id, relationType: "reviews" });
      expect(database.listTaskEvents(taskA.id)).toHaveLength(eventsBeforeA + 1);
      expect(database.listTaskEvents(taskB.id)).toHaveLength(eventsBeforeB + 1);
    });
  });

  it("records a role change separately from a new session assignment", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Role events" });
      const task = database.createTask({ projectId: project.id, title: "Review task" });
      const session = database.createSession({ projectId: project.id, name: "Review Chat", provider: "chatgpt" });

      database.assignSessionToTask({ taskId: task.id, sessionId: session.id, role: "architect" });
      database.assignSessionToTask({ taskId: task.id, sessionId: session.id, role: "reviewer" });

      expect(database.listTaskEvents(task.id).map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["session_linked", "session_role_changed"]),
      );
      expect(database.listTaskEvents(task.id).find((event) => event.eventType === "session_role_changed")?.payload).toEqual(
        expect.objectContaining({ sessionId: session.id, previousRole: "architect", role: "reviewer" }),
      );
    });
  });
});
