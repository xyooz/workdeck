import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { RELATION_COMPATIBILITY, RELATION_TYPES, type RelationType } from "@workdeck/domain";
import { api, type Artifact, type ArtifactType, type BoardResponse, type BoardTask, type Priority, type Project, type ProjectSession, type Provider, type SessionRole, type SessionStatus, type Task, type TaskDetail, type TaskSession, type TaskStatus } from "./api";

const COLUMNS: Array<{ key: TaskStatus; label: string; eyebrow: string }> = [
  { key: "backlog", label: "Backlog", eyebrow: "Queued" },
  { key: "designing", label: "Designing", eyebrow: "Shape the work" },
  { key: "implementing", label: "Implementing", eyebrow: "In motion" },
  { key: "reviewing", label: "Reviewing", eyebrow: "Needs signal" },
  { key: "blocked", label: "Blocked", eyebrow: "Needs attention" },
  { key: "done", label: "Done", eyebrow: "Shipped" },
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  designing: "Designing",
  implementing: "Implementing",
  reviewing: "Reviewing",
  blocked: "Blocked",
  done: "Done",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const ROLE_LABELS: Record<SessionRole, string> = {
  architect: "Architect",
  implementer: "Implementer",
  reviewer: "Reviewer",
  researcher: "Researcher",
};

const PROVIDER_LABELS: Record<Provider, string> = {
  chatgpt: "ChatGPT",
  codex: "Codex",
  claude: "Claude",
  local: "Local",
  other: "Other",
};

const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  commit: "Commit",
  pull_request: "Pull request",
  file: "File",
  report: "Report",
  test_run: "Test run",
  other: "Other",
};

const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  active: "Active",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  archived: "Archived",
};

const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function relativeTime(timestamp: string) {
  const delta = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function taskCode(task: Task) {
  return task.id.startsWith("task-") ? task.id.replace("task-", "").toUpperCase() : task.id.slice(0, 8).toUpperCase();
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [projectSessions, setProjectSessions] = useState<ProjectSession[]>([]);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [modal, setModal] = useState<"project" | "task" | "session" | "artifact" | "relation" | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [loadingTask, setLoadingTask] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProjects = useCallback(async (preferredId?: string) => {
    try {
      setLoadingProjects(true);
      const result = await api.listProjects();
      setProjects(result.projects);
      setSelectedProjectId((current) => preferredId ?? current ?? result.projects[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load projects");
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadBoard = useCallback(async (projectId: string) => {
    try {
      setLoadingBoard(true);
      setBoard(await api.getBoard(projectId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load board");
    } finally {
      setLoadingBoard(false);
    }
  }, []);

  const loadTask = useCallback(async (taskId: string) => {
    try {
      setLoadingTask(true);
      setTaskDetail(await api.getTask(taskId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load task");
    } finally {
      setLoadingTask(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId) void loadBoard(selectedProjectId);
    else setBoard(null);
  }, [loadBoard, selectedProjectId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? board?.project ?? null;
  const activeTaskCount = board?.tasks.filter((task) => !["done", "backlog"].includes(task.status)).length ?? 0;
  const blockedCount = board?.tasks.filter((task) => task.status === "blocked").length ?? 0;
  const activeSessionCount = board ? new Set(board.tasks.flatMap((task) => task.sessions.filter((session) => session.status === "active").map((session) => session.id))).size : 0;

  const refreshWorkspace = async () => {
    if (selectedProjectId) await loadBoard(selectedProjectId);
    await loadProjects(selectedProjectId ?? undefined);
    if (selectedTaskId) await loadTask(selectedTaskId);
  };

  const openTask = async (taskId: string) => {
    setSelectedTaskId(taskId);
    setHandoff(null);
    await loadTask(taskId);
  };

  const openSessionModal = async () => {
    if (!selectedProjectId) return;
    try {
      const result = await api.listProjectSessions(selectedProjectId);
      setProjectSessions(result.sessions);
      setModal("session");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load sessions");
    }
  };

  const openRelationModal = () => {
    if (!taskDetail) return;
    setModal("relation");
  };

  const saveTaskStatus = async (status: TaskStatus) => {
    if (!taskDetail) return;
    try {
      await api.updateTask(taskDetail.task.id, { status });
      setNotice(`Moved to ${STATUS_LABELS[status]}`);
      await refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update task");
    }
  };

  const saveTaskPriority = async (priority: Priority) => {
    if (!taskDetail) return;
    try {
      await api.updateTask(taskDetail.task.id, { priority });
      setNotice("Priority updated");
      await refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update task");
    }
  };

  const saveTaskContext = async (input: Partial<Pick<Task, "goal" | "architectureNotes" | "reviewContext" | "acceptanceCriteria" | "constraints" | "nextStep">>) => {
    if (!taskDetail) return;
    try {
      await api.updateTask(taskDetail.task.id, input);
      setNotice("Handoff context saved");
      await refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save handoff context");
    }
  };

  const createProject = async (name: string, description: string) => {
    try {
      const result = await api.createProject({ name, description });
      setModal(null);
      await loadProjects(result.project.id);
      setNotice("Project created");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create project");
    }
  };

  const createTask = async (input: { title: string; description: string; status: TaskStatus; priority: Priority; parentTaskId: string | null }) => {
    if (!selectedProjectId) return;
    try {
      await api.createTask(selectedProjectId, input);
      setModal(null);
      await refreshWorkspace();
      setNotice("Task added to the board");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create task");
    }
  };

  const createSession = async (input: Record<string, unknown>) => {
    if (!taskDetail) return;
    try {
      await api.createSession(taskDetail.task.id, input);
      setModal(null);
      await refreshWorkspace();
      setNotice("Session linked");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not link session");
    }
  };

  const createArtifact = async (input: Record<string, unknown>) => {
    if (!taskDetail) return;
    try {
      await api.createArtifact(taskDetail.task.id, input);
      setModal(null);
      await refreshWorkspace();
      setNotice("Artifact attached");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not attach artifact");
    }
  };

  const createRelation = async (input: { sourceType: string; sourceId: string; targetType: string; targetId: string; relationType: string }) => {
    try {
      await api.createRelation(input);
      setModal(null);
      await refreshWorkspace();
      setNotice("Relation recorded");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create relation");
    }
  };

  const generateHandoff = async () => {
    if (!taskDetail) return;
    try {
      const result = await api.getHandoff(taskDetail.task.id);
      setHandoff(result.markdown);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate handoff");
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">WorkDeck</div>
            <div className="brand-caption">AI work control plane</div>
          </div>
        </div>

        <div className="workspace-switcher">
          <span className="status-dot" />
          <span>Local workspace</span>
          <span className="chevron">⌄</span>
        </div>

        <div className="sidebar-section-label">
          <span>Projects</span>
          <button className="icon-button small" onClick={() => setModal("project")} aria-label="Create project">＋</button>
        </div>
        <div className="project-list">
          {loadingProjects ? <div className="sidebar-placeholder">Loading projects…</div> : null}
          {!loadingProjects && projects.length === 0 ? <div className="sidebar-placeholder">No projects yet.</div> : null}
          {projects.map((project) => (
            <button
              className={`project-item ${project.id === selectedProjectId ? "selected" : ""}`}
              key={project.id}
              onClick={() => {
                setSelectedProjectId(project.id);
                setSelectedTaskId(null);
                setTaskDetail(null);
              }}
            >
              <span className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</span>
              <span className="project-item-copy">
                <span className="project-item-name">{project.name}</span>
                <span className="project-item-meta">{project.taskCount ?? 0} tasks</span>
              </span>
              {project.id === selectedProjectId ? <span className="project-active-mark" /> : null}
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">✦</span>
            <div>
              <strong>Built for handoffs</strong>
              <span>Keep every session, artifact and decision in context.</span>
            </div>
          </div>
          <div className="sidebar-footer"><span className="footer-pulse" /> Phase 0.1 · Local only</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{selectedProject?.name ?? "Projects"}</strong></div>
          <div className="topbar-actions">
            <span className="sync-status"><span className="status-dot" /> Saved locally</span>
            <button className="avatar-button">M</button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> WORKBOARD</div>
              <h1>{selectedProject?.name ?? "Your workspace"}</h1>
              <p>{selectedProject?.description || "Organize AI-assisted work around tasks, sessions and outcomes."}</p>
            </div>
            <div className="heading-actions">
              <button className="button secondary" onClick={() => setModal("project")}><span>＋</span> Project</button>
              <button className="button primary" disabled={!selectedProjectId} onClick={() => setModal("task")}><span>＋</span> New task</button>
            </div>
          </div>

          <div className="metric-strip">
            <Metric label="Active work" value={activeTaskCount} accent="blue" />
            <Metric label="In review" value={board?.tasks.filter((task) => task.status === "reviewing").length ?? 0} accent="violet" />
            <Metric label="Live sessions" value={activeSessionCount} accent="green" />
            <Metric label="Blocked" value={blockedCount} accent="orange" />
          </div>

          {error ? <div className="error-banner"><span>!</span>{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}

          <div className="board-toolbar">
            <div className="board-toolbar-title"><span className="board-grid-icon">⊞</span><strong>Delivery board</strong><span className="task-count">{board?.tasks.length ?? 0} tasks</span></div>
            <div className="toolbar-actions"><button className="toolbar-button active">Board</button><button className="toolbar-button" disabled>Timeline</button><button className="toolbar-button" disabled>⌕</button></div>
          </div>

          <div className="board-frame">
            {loadingBoard ? <div className="board-loading"><span className="spinner" /> Loading board…</div> : null}
            {!loadingBoard && !selectedProjectId ? <EmptyState onCreate={() => setModal("project")} /> : null}
            {!loadingBoard && selectedProjectId && board ? (
              <div className="board-scroll">
                {COLUMNS.map((column) => {
                  const columnTasks = board.tasks.filter((task) => task.status === column.key);
                  return <BoardColumn key={column.key} column={column} tasks={columnTasks} onTaskClick={openTask} />;
                })}
              </div>
            ) : null}
          </div>
          <div className="board-footer"><span className="legend-dot blue" /> Click a task to inspect its sessions, artifacts, relations and handoff context <span className="footer-key">⌘ K</span></div>
        </div>
      </main>

      {selectedTaskId ? (
        <TaskDrawer
          detail={taskDetail}
          loading={loadingTask}
          onClose={() => {
            setSelectedTaskId(null);
            setTaskDetail(null);
            setHandoff(null);
          }}
          onStatusChange={saveTaskStatus}
          onPriorityChange={saveTaskPriority}
          onNewSession={() => void openSessionModal()}
          onNewArtifact={() => setModal("artifact")}
          onNewRelation={() => void openRelationModal()}
          onSaveContext={saveTaskContext}
          onGenerateHandoff={() => void generateHandoff()}
        />
      ) : null}

      {handoff ? <HandoffModal markdown={handoff} onClose={() => setHandoff(null)} onCopied={() => setNotice("Handoff copied to clipboard")} /> : null}
      {modal === "project" ? <Modal title="Create project" onClose={() => setModal(null)}><ProjectForm onSubmit={createProject} onCancel={() => setModal(null)} /></Modal> : null}
      {modal === "task" ? <Modal title="Add task" onClose={() => setModal(null)}><TaskForm tasks={board?.tasks ?? []} onSubmit={createTask} onCancel={() => setModal(null)} /></Modal> : null}
      {modal === "session" && taskDetail ? <Modal title="Link a session" subtitle={`Connect work to ${taskDetail.task.title}`} onClose={() => setModal(null)}><SessionForm sessions={projectSessions} currentTaskId={taskDetail.task.id} onSubmit={createSession} onCancel={() => setModal(null)} /></Modal> : null}
      {modal === "artifact" && taskDetail ? <Modal title="Attach artifact" subtitle="Record the outcome this task produced" onClose={() => setModal(null)}><ArtifactForm onSubmit={createArtifact} onCancel={() => setModal(null)} /></Modal> : null}
      {modal === "relation" && taskDetail ? <Modal title="Add relation" subtitle="Connect work without coupling it to a provider" onClose={() => setModal(null)}><RelationForm task={taskDetail.task} tasks={board?.tasks ?? []} sessions={taskDetail.sessions} artifacts={taskDetail.artifacts} onSubmit={createRelation} onCancel={() => setModal(null)} /></Modal> : null}
      {notice ? <div className="toast"><span className="toast-check">✓</span>{notice}</div> : null}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return <div className="metric"><span className={`metric-icon ${accent}`} /><div><span className="metric-label">{label}</span><strong>{value}</strong></div></div>;
}

function BoardColumn({ column, tasks, onTaskClick }: { column: (typeof COLUMNS)[number]; tasks: BoardTask[]; onTaskClick: (taskId: string) => void }) {
  return (
    <section className={`board-column column-${column.key}`}>
      <div className="column-header"><div><div className="column-title"><span className="column-dot" />{column.label}<span className="column-count">{tasks.length}</span></div><div className="column-eyebrow">{column.eyebrow}</div></div><button className="column-menu" aria-label={`${column.label} options`}>•••</button></div>
      <div className="column-cards">
        {tasks.map((task) => <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />)}
        {tasks.length === 0 ? <div className="empty-column"><span>·</span><span>No tasks here</span></div> : null}
      </div>
    </section>
  );
}

function TaskCard({ task, onClick }: { task: BoardTask; onClick: () => void }) {
  const implementer = task.sessions.find((session) => session.role === "implementer");
  const reviewer = task.sessions.find((session) => session.role === "reviewer");
  return (
    <button className="task-card" onClick={onClick}>
      <div className="task-card-top"><span className="task-code">{taskCode(task)}</span><span className={`priority priority-${task.priority}`}><span className="priority-glyph">{task.priority === "critical" ? "◆" : task.priority === "high" ? "▲" : task.priority === "medium" ? "●" : "–"}</span>{PRIORITY_LABELS[task.priority]}</span></div>
      <h3>{task.title}</h3>
      {task.description ? <p className="task-description">{task.description}</p> : null}
      <div className="card-context">
        <ContextRow label="Executor" value={implementer?.name ?? "Unassigned"} icon="↗" muted={!implementer} />
        <ContextRow label="Reviewer" value={reviewer?.name ?? "Unassigned"} icon="◌" muted={!reviewer} />
      </div>
      <div className="task-card-bottom">
        <span className="latest-artifact">{task.latestArtifact ? <><span className="artifact-mini-icon">⌁</span>{task.latestArtifact.externalRef || task.latestArtifact.title}</> : <><span className="artifact-mini-icon muted-icon">⌁</span>No artifact</>}</span>
        <span className="updated-time">{relativeTime(task.updatedAt)}</span>
      </div>
    </button>
  );
}

function ContextRow({ label, value, icon, muted }: { label: string; value: string; icon: string; muted?: boolean }) {
  return <div className="context-row"><span className="context-label"><span className="context-icon">{icon}</span>{label}</span><span className={`context-value ${muted ? "muted" : ""}`}>{value}</span></div>;
}

function TaskDrawer({ detail, loading, onClose, onStatusChange, onPriorityChange, onNewSession, onNewArtifact, onNewRelation, onSaveContext, onGenerateHandoff }: { detail: TaskDetail | null; loading: boolean; onClose: () => void; onStatusChange: (status: TaskStatus) => void; onPriorityChange: (priority: Priority) => void; onNewSession: () => void; onNewArtifact: () => void; onNewRelation: () => void; onSaveContext: (input: Partial<Pick<Task, "goal" | "architectureNotes" | "reviewContext" | "acceptanceCriteria" | "constraints" | "nextStep">>) => Promise<void>; onGenerateHandoff: () => void }) {
  return (
    <div className="drawer-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="task-drawer">
        <div className="drawer-topbar"><span className="drawer-kicker">TASK DETAIL</span><button className="icon-button" onClick={onClose} aria-label="Close task detail">×</button></div>
        {loading || !detail ? <div className="drawer-loading"><span className="spinner" /> Loading task…</div> : <>
          <div className="drawer-heading"><div className="drawer-task-code">{taskCode(detail.task)}</div><div className="drawer-title-row"><h2>{detail.task.title}</h2><span className={`drawer-priority priority-${detail.task.priority}`}>{PRIORITY_LABELS[detail.task.priority]}</span></div><p>{detail.project.name} · updated {relativeTime(detail.task.updatedAt)}</p></div>
          <div className="drawer-controls"><label><span>Status</span><select value={detail.task.status} onChange={(event) => onStatusChange(event.target.value as TaskStatus)}>{COLUMNS.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label><label><span>Priority</span><select value={detail.task.priority} onChange={(event) => onPriorityChange(event.target.value as Priority)}>{Object.keys(PRIORITY_LABELS).map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority as Priority]}</option>)}</select></label></div>
          <DrawerSection title="Basic" icon="◈"><div className="basic-copy">{detail.task.description || "No task description yet."}</div>{detail.parentTask ? <div className="parent-task"><span>Parent task</span><strong>{detail.parentTask.title}</strong></div> : null}</DrawerSection>
          <TaskContextEditor task={detail.task} onSave={onSaveContext} />
          <DrawerSection title="Sessions" icon="◉" action={<button className="section-add" onClick={onNewSession}>＋ Add</button>}><div className="session-list">{detail.sessions.length ? detail.sessions.map((session) => <SessionRow key={session.id} session={session} />) : <EmptySection copy="No sessions linked yet." />}</div></DrawerSection>
          <DrawerSection title="Artifacts" icon="⌁" action={<button className="section-add" onClick={onNewArtifact}>＋ Add</button>}><div className="artifact-list">{detail.artifacts.length ? detail.artifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} />) : <EmptySection copy="No artifacts attached yet." />}</div></DrawerSection>
          <DrawerSection title="Relations" icon="⤢" action={<button className="section-add" onClick={onNewRelation}>＋ Add</button>}><div className="relation-list">{detail.relations.length ? detail.relations.map((relation) => <div className="relation-row" key={relation.id}><span className="relation-node">{relation.source.label}</span><span className="relation-arrow"><span>{titleCase(relation.relationType)}</span> →</span><span className="relation-node target">{relation.target.label}</span></div>) : <EmptySection copy="No relations recorded yet." />}</div></DrawerSection>
          <DrawerSection title="Event trail" icon="◷"><div className="event-list">{detail.events.slice(0, 6).map((event) => <div className="event-row" key={event.id}><span className="event-dot" /><div><strong>{titleCase(event.eventType)}</strong><span>{relativeTime(event.createdAt)}</span></div></div>)}</div></DrawerSection>
          <div className="drawer-bottom"><button className="button primary full" onClick={onGenerateHandoff}><span>✦</span> Generate handoff</button><span className="drawer-bottom-hint">Create a portable Markdown brief for the next session.</span></div>
        </>}
      </aside>
    </div>
  );
}

function DrawerSection({ title, icon, action, children }: { title: string; icon: string; action?: ReactNode; children: ReactNode }) {
  return <section className="drawer-section"><div className="drawer-section-heading"><h3><span className="section-icon">{icon}</span>{title}</h3>{action}</div>{children}</section>;
}

function TaskContextEditor({ task, onSave }: { task: Task; onSave: (input: Partial<Pick<Task, "goal" | "architectureNotes" | "reviewContext" | "acceptanceCriteria" | "constraints" | "nextStep">>) => Promise<void> }) {
  const [values, setValues] = useState({ goal: task.goal, architectureNotes: task.architectureNotes, reviewContext: task.reviewContext, acceptanceCriteria: task.acceptanceCriteria, constraints: task.constraints, nextStep: task.nextStep });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValues({ goal: task.goal, architectureNotes: task.architectureNotes, reviewContext: task.reviewContext, acceptanceCriteria: task.acceptanceCriteria, constraints: task.constraints, nextStep: task.nextStep });
  }, [task.id, task.goal, task.architectureNotes, task.reviewContext, task.acceptanceCriteria, task.constraints, task.nextStep]);
  const update = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await onSave(values); } finally { setBusy(false); } };
  return <section className="drawer-section handoff-context-section"><div className="drawer-section-heading"><h3><span className="section-icon">✦</span>Handoff context</h3><span className="context-badge">portable</span></div><form className="context-editor" onSubmit={save}><label><span>Goal</span><textarea value={values.goal} onChange={(event) => update("goal", event.target.value)} placeholder="What outcome should this task deliver?" rows={2} /></label><label><span>Key architecture decisions</span><textarea value={values.architectureNotes} onChange={(event) => update("architectureNotes", event.target.value)} placeholder="Boundaries, interfaces, trade-offs…" rows={3} /></label><label><span>Review findings / fix context</span><textarea value={values.reviewContext} onChange={(event) => update("reviewContext", event.target.value)} placeholder="P0/P1 issues, review notes…" rows={3} /></label><div className="context-editor-grid"><label><span>Acceptance criteria</span><textarea value={values.acceptanceCriteria} onChange={(event) => update("acceptanceCriteria", event.target.value)} placeholder="What proves this is done?" rows={3} /></label><label><span>Protected constraints</span><textarea value={values.constraints} onChange={(event) => update("constraints", event.target.value)} placeholder="What must not break?" rows={3} /></label></div><label><span>Next step</span><textarea value={values.nextStep} onChange={(event) => update("nextStep", event.target.value)} placeholder="The next concrete action…" rows={2} /></label><button type="submit" className="context-save" disabled={busy}>{busy ? "Saving…" : "Save context"}</button></form></section>;
}

function SessionRow({ session }: { session: TaskSession }) {
  return <div className="session-row"><div className={`session-avatar role-${session.role}`}>{session.name.slice(0, 1).toUpperCase()}</div><div className="session-copy"><strong>{session.name}</strong><span>{ROLE_LABELS[session.role]} · {PROVIDER_LABELS[session.provider]}</span></div><span className={`session-status status-${session.status}`}><span />{SESSION_STATUS_LABELS[session.status]}</span></div>;
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  return <div className="artifact-row"><div className={`artifact-type artifact-${artifact.type}`}>{artifact.type === "commit" ? "⌘" : artifact.type === "report" ? "▤" : "⌁"}</div><div className="artifact-copy"><strong>{artifact.title}</strong><span>{ARTIFACT_LABELS[artifact.type]}{artifact.externalRef ? ` · ${artifact.externalRef}` : ""}</span></div>{artifact.externalUrl ? <a href={artifact.externalUrl} target="_blank" rel="noreferrer" className="external-link">↗</a> : null}</div>;
}

function EmptySection({ copy }: { copy: string }) { return <div className="empty-section">{copy}</div>; }

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-state"><div className="empty-state-mark">W</div><h2>Start your first project</h2><p>Turn AI sessions into a visible delivery path with tasks, artifacts and handoffs.</p><button className="button primary" onClick={onCreate}>＋ Create project</button></div>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><div className="modal-header"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div>{children}</div></div>;
}

function ProjectForm({ onSubmit, onCancel }: { onSubmit: (name: string, description: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; setBusy(true); try { await onSubmit(name, description); } finally { setBusy(false); } };
  return <form className="form" onSubmit={submit}><label><span>Project name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. AgentDeck" /></label><label><span>Description <em>Optional</em></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What are you building?" rows={3} /></label><FormActions onCancel={onCancel} busy={busy} submitLabel="Create project" /> </form>;
}

function TaskForm({ tasks, onSubmit, onCancel }: { tasks: BoardTask[]; onSubmit: (input: { title: string; description: string; status: TaskStatus; priority: Priority; parentTaskId: string | null }) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("medium");
  const [parentTaskId, setParentTaskId] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; setBusy(true); try { await onSubmit({ title, description, status, priority, parentTaskId: parentTaskId || null }); } finally { setBusy(false); } };
  return <form className="form" onSubmit={submit}><label><span>Task title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Define session boundary" /></label><label><span>Description <em>Optional</em></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the outcome or constraint…" rows={4} /></label><div className="form-grid"><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>{COLUMNS.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label><label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{Object.entries(PRIORITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><label><span>Parent task <em>Optional</em></span><select value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)}><option value="">No parent</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><FormActions onCancel={onCancel} busy={busy} submitLabel="Add task" /></form>;
}

function SessionForm({ sessions, currentTaskId, onSubmit, onCancel }: { sessions: ProjectSession[]; currentTaskId: string; onSubmit: (input: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [mode, setMode] = useState<"new" | "existing">(sessions.some((session) => !session.assignments.length || session.assignments.every((assignment) => assignment.taskId !== currentTaskId)) ? "existing" : "new");
  const [sessionId, setSessionId] = useState(sessions.find((session) => !session.assignments.length || session.assignments.every((assignment) => assignment.taskId !== currentTaskId))?.id ?? "");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Provider>("codex");
  const [role, setRole] = useState<SessionRole>("implementer");
  const [existingRole, setExistingRole] = useState<SessionRole>("reviewer");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const available = sessions.filter((session) => !session.assignments.some((assignment) => assignment.taskId === currentTaskId));
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await onSubmit(mode === "existing" ? { sessionId, role: existingRole } : { name, provider, role, status: "active", summary }); } finally { setBusy(false); } };
  return <form className="form" onSubmit={submit}><div className="segmented-control"><button type="button" className={mode === "existing" ? "active" : ""} onClick={() => setMode("existing")} disabled={!available.length}>Existing session</button><button type="button" className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>New session</button></div>{mode === "existing" ? <><label><span>Choose a session</span><select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>{available.length ? available.map((session) => <option key={session.id} value={session.id}>{session.name}{session.assignments.length ? ` · ${session.assignments.map((assignment) => ROLE_LABELS[assignment.role]).join(" / ")}` : " · unassigned"}</option>) : <option value="">No other sessions</option>}</select></label><label><span>Role for this task</span><select value={existingRole} onChange={(event) => setExistingRole(event.target.value as SessionRole)}>{Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></> : <><label><span>Session name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Review Chat" /></label><div className="form-grid"><label><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>{Object.entries(PROVIDER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>Role for this task</span><select value={role} onChange={(event) => setRole(event.target.value as SessionRole)}>{Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><label><span>Summary <em>Optional</em></span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is this session responsible for?" rows={3} /></label></>}<FormActions onCancel={onCancel} busy={busy} submitLabel={mode === "existing" ? "Link session" : "Create & link"} /></form>;
}

function RelationForm({ task, tasks, sessions, artifacts, onSubmit, onCancel }: { task: Task; tasks: BoardTask[]; sessions: TaskSession[]; artifacts: Artifact[]; onSubmit: (input: { sourceType: string; sourceId: string; targetType: string; targetId: string; relationType: string }) => Promise<void>; onCancel: () => void }) {
  const entities = useMemo(() => [
    ...tasks.map((candidate) => ({ value: `task:${candidate.id}`, type: "task" as const, id: candidate.id, label: `Task · ${candidate.title}` })),
    ...sessions.map((session) => ({ value: `session:${session.id}`, type: "session" as const, id: session.id, label: `Session · ${session.name} · ${ROLE_LABELS[session.role]}` })),
    ...artifacts.map((artifact) => ({ value: `artifact:${artifact.id}`, type: "artifact" as const, id: artifact.id, label: `Artifact · ${artifact.title}` })),
  ], [artifacts, sessions, tasks]);
  const currentValue = `task:${task.id}`;
  const firstOther = entities.find((entity) => entity.value !== currentValue)?.value ?? currentValue;
  const [source, setSource] = useState(currentValue);
  const [target, setTarget] = useState(firstOther);
  const [relationType, setRelationType] = useState<RelationType>("depends_on");
  const [busy, setBusy] = useState(false);
  const sourceEntity = entities.find((entity) => entity.value === source);
  const targetEntity = entities.find((entity) => entity.value === target);
  const allowedRelationTypes = useMemo(
    () => RELATION_TYPES.filter((candidate) => sourceEntity && targetEntity && RELATION_COMPATIBILITY[candidate].some(([allowedSource, allowedTarget]) => allowedSource === sourceEntity.type && allowedTarget === targetEntity.type)),
    [sourceEntity, targetEntity],
  );
  useEffect(() => {
    if (allowedRelationTypes.length && !allowedRelationTypes.includes(relationType)) setRelationType(allowedRelationTypes[0]);
  }, [allowedRelationTypes, relationType]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (source === target || !sourceEntity || !targetEntity || !allowedRelationTypes.includes(relationType)) return;
    setBusy(true);
    try {
      await onSubmit({ sourceType: sourceEntity.type, sourceId: sourceEntity.id, targetType: targetEntity.type, targetId: targetEntity.id, relationType });
    } finally {
      setBusy(false);
    }
  };
  return <form className="form" onSubmit={submit}><label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value)}>{entities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}</select></label><label><span>Relation type</span><select value={relationType} onChange={(event) => setRelationType(event.target.value as RelationType)} disabled={!allowedRelationTypes.length}>{allowedRelationTypes.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}</select></label><label><span>Target</span><select value={target} onChange={(event) => setTarget(event.target.value)}>{entities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}</select></label><p className="relation-form-hint">{allowedRelationTypes.length ? `Allowed in this context: ${allowedRelationTypes.map(titleCase).join(", ")}. Sessions and artifacts are limited to this task.` : "No supported relation for this source and target. Choose a compatible endpoint pair."}</p><FormActions onCancel={onCancel} busy={busy} disabled={!allowedRelationTypes.length || source === target} submitLabel="Add relation" /></form>;
}

function ArtifactForm({ onSubmit, onCancel }: { onSubmit: (input: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [type, setType] = useState<ArtifactType>("commit");
  const [title, setTitle] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; setBusy(true); try { await onSubmit({ type, title, externalRef: externalRef || null, externalUrl: externalUrl || null, metadata: {} }); } finally { setBusy(false); } };
  return <form className="form" onSubmit={submit}><label><span>Artifact type</span><select value={type} onChange={(event) => setType(event.target.value as ArtifactType)}>{Object.entries(ARTIFACT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. ec565d5 · baseline" /></label><div className="form-grid"><label><span>Reference <em>Optional</em></span><input value={externalRef} onChange={(event) => setExternalRef(event.target.value)} placeholder="ec565d5" /></label><label><span>URL <em>Optional</em></span><input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://…" /></label></div><FormActions onCancel={onCancel} busy={busy} submitLabel="Attach artifact" /></form>;
}

function FormActions({ onCancel, busy, disabled, submitLabel }: { onCancel: () => void; busy: boolean; disabled?: boolean; submitLabel: string }) {
  return <div className="form-actions"><button type="button" className="button secondary" onClick={onCancel}>Cancel</button><button type="submit" className="button primary" disabled={busy || disabled}>{busy ? <><span className="button-spinner" />Saving…</> : submitLabel}</button></div>;
}

function HandoffModal({ markdown, onClose, onCopied }: { markdown: string; onClose: () => void; onCopied: () => void }) {
  const copy = async () => { await navigator.clipboard.writeText(markdown); onCopied(); };
  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal handoff-modal"><div className="modal-header"><div><div className="eyebrow"><span className="eyebrow-line" /> HANDOFF GENERATOR</div><h2>Ready for the next session</h2><p>Portable context, rendered from the task graph.</p></div><button className="icon-button" onClick={onClose} aria-label="Close handoff">×</button></div><pre className="handoff-preview">{markdown}</pre><div className="handoff-actions"><span className="handoff-meta">Markdown · {markdown.split("\n").length} lines</span><div><button className="button secondary" onClick={onClose}>Close</button><button className="button primary" onClick={() => void copy()}><span>▣</span> Copy Markdown</button></div></div></div></div>;
}

export default App;
