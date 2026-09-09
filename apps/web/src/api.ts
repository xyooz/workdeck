export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  taskCount?: number;
};

export type TaskStatus = "backlog" | "designing" | "implementing" | "reviewing" | "blocked" | "done";
export type Priority = "low" | "medium" | "high" | "critical";
export type SessionRole = "architect" | "implementer" | "reviewer" | "researcher";
export type Provider = "chatgpt" | "codex" | "claude" | "local" | "other";
export type SessionStatus = "active" | "waiting" | "completed" | "failed" | "archived";
export type ArtifactType = "commit" | "pull_request" | "file" | "report" | "test_run" | "other";

export type Task = {
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
};

export type Session = {
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
};

export type TaskSession = Session & {
  taskId: string;
  role: SessionRole;
  assignmentCreatedAt: string;
  assignmentUpdatedAt: string;
};

export type ProjectSession = Session & {
  assignments: Array<{
    taskId: string;
    sessionId: string;
    role: SessionRole;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type Artifact = {
  id: string;
  projectId: string;
  type: ArtifactType;
  title: string;
  externalRef: string | null;
  externalUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type BoardTask = Task & {
  sessions: TaskSession[];
  artifacts: Artifact[];
  latestArtifact: Artifact | null;
};

export type Relation = {
  id: string;
  sourceType: "project" | "task" | "session" | "artifact";
  sourceId: string;
  targetType: "project" | "task" | "session" | "artifact";
  targetId: string;
  relationType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  source: { type: string; id: string; label: string };
  target: { type: string; id: string; label: string };
};

export type TaskEvent = {
  id: string;
  taskId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type BoardResponse = { project: Project; tasks: BoardTask[] };
export type TaskDetail = {
  task: Task;
  project: Project;
  parentTask: Task | null;
  sessions: TaskSession[];
  artifacts: Artifact[];
  latestArtifact: Artifact | null;
  relations: Relation[];
  events: TaskEvent[];
};

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
  listProjects: () => request<{ projects: Project[] }>("/api/projects"),
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
  createRelation: (body: { sourceType: string; sourceId: string; targetType: string; targetId: string; relationType: string }) =>
    request<{ relation: Relation }>("/api/relations", { method: "POST", body: JSON.stringify(body) }),
};
