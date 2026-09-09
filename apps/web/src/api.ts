import type {
  ArtifactView,
  BoardView,
  InboxItem,
  ProjectListItem,
  ProjectSessionView,
  ProjectView,
  RelationView,
  SessionView,
  TaskCardView,
  TaskDetailView,
  TaskEventView,
  TaskSessionView,
  TaskView,
} from "@workdeck/app-contracts";

export type Project = ProjectView & { taskCount?: number };

export type TaskStatus = "backlog" | "designing" | "implementing" | "reviewing" | "blocked" | "done";
export type Priority = "low" | "medium" | "high" | "critical";
export type SessionRole = "architect" | "implementer" | "reviewer" | "researcher";
export type Provider = "chatgpt" | "codex" | "claude" | "local" | "other";
export type SessionStatus = "active" | "waiting" | "completed" | "failed" | "archived";
export type ArtifactType = "commit" | "pull_request" | "file" | "report" | "test_run" | "other";

export type Task = TaskView;
export type Session = SessionView;
export type TaskSession = TaskSessionView;
export type ProjectSession = ProjectSessionView;
export type Artifact = ArtifactView;
export type BoardTask = TaskCardView;
export type Relation = RelationView;
export type TaskEvent = TaskEventView;
export type BoardResponse = BoardView;
export type TaskDetail = TaskDetailView;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; issues?: unknown };
  if (!response.ok) {
    const detail = payload.error ?? "Request failed";
    throw new Error(detail);
  }
  return payload;
}

export const api = {
  listProjects: () => request<{ projects: ProjectListItem[] }>("/api/projects"),
  createProject: (body: { name: string; description: string }) =>
    request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getBoard: (projectId: string) => request<BoardResponse>(`/api/projects/${projectId}/board`),
  createTask: (projectId: string, body: { title: string; description: string; status: TaskStatus; priority: Priority; parentTaskId: string | null; goal?: string; architectureNotes?: string; reviewContext?: string; acceptanceCriteria?: string; constraints?: string; nextStep?: string }) =>
    request<{ task: Task }>(`/api/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
  getTask: (taskId: string) => request<TaskDetail>(`/api/tasks/${taskId}`),
  updateTask: (taskId: string, body: Partial<Pick<Task, "title" | "description" | "goal" | "architectureNotes" | "reviewContext" | "acceptanceCriteria" | "constraints" | "nextStep" | "status" | "priority" | "parentTaskId">>) =>
    request<{ task: Task }>(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }),
  listProjectSessions: (projectId: string) => request<{ sessions: ProjectSession[] }>(`/api/projects/${projectId}/sessions`),
  createSession: (taskId: string, body: Record<string, unknown>) =>
    request<{ session: Session }>(`/api/tasks/${taskId}/sessions`, { method: "POST", body: JSON.stringify(body) }),
  createArtifact: (taskId: string, body: Record<string, unknown>) =>
    request<{ artifact: Artifact }>(`/api/tasks/${taskId}/artifacts`, { method: "POST", body: JSON.stringify(body) }),
  getHandoff: (taskId: string) => request<{ markdown: string }>(`/api/tasks/${taskId}/handoff`),
  getInbox: (projectId?: string) => request<{ items: InboxItem[] }>(`/api/inbox${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  createRelation: (body: { sourceType: string; sourceId: string; targetType: string; targetId: string; relationType: string }) =>
    request<{ relation: Relation }>("/api/relations", { method: "POST", body: JSON.stringify(body) }),
};
