import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      expect(() => database.createSession({ projectId: project.id, taskId: task.id, name: "Bad role", role: "operator" as never })).toThrow();
      expect(() => database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "artifact", targetId: "missing", relationType: "produces" })).toThrow(/not found/);
      expect(() => database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "task", targetId: task.id, relationType: "depends_on" })).toThrow(/itself/);
    });
  });

  it("records task events for create, status change, links, artifacts and relations", () => {
    withDatabase((database) => {
      const project = database.createProject({ name: "Events" });
      const task = database.createTask({ projectId: project.id, title: "Trace events" });
      const session = database.createSession({ projectId: project.id, taskId: task.id, name: "Implementer", provider: "codex", role: "implementer" });
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
      expect(second.migrationVersions).toEqual([1]);
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
      const task = database.createTask({ projectId: project.id, title: "Continue delivery", description: "Carry the implementation forward.", status: "implementing", priority: "high" });
      database.createRelation({ sourceType: "task", sourceId: task.id, targetType: "task", targetId: dependency.id, relationType: "depends_on" });
      const session = database.createSession({ projectId: project.id, taskId: task.id, name: "Codex implementer", provider: "codex", role: "implementer", summary: "Working on the next slice." });
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
    });
  });
});
