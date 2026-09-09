import { McpAppsBridge } from "./bridge.js";

type WidgetMode = "task" | "board" | "inbox";

type OpenAIWidgetBridge = {
  toolInput?: unknown;
  toolOutput?: unknown;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage?: (message: string) => Promise<unknown>;
  subscribe?: (listener: (event: unknown) => void) => (() => void) | void;
};

declare global {
  interface Window {
    openai?: OpenAIWidgetBridge;
    __WORKDECK_WIDGET_MODE__?: WidgetMode;
    __WORKDECK_TOOL_OUTPUT__?: unknown;
    __WORKDECK_TOOL_INPUT__?: unknown;
  }
}

const style = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8f8fb; color: #20212a; }
* { box-sizing: border-box; }
body { margin: 0; background: #f8f8fb; }
.wd-card { padding: 16px; max-width: 720px; }
.wd-shell { border: 1px solid #e6e5ed; border-radius: 16px; background: #fff; box-shadow: 0 6px 24px rgba(35, 31, 56, .07); overflow: hidden; }
.wd-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 17px; border-bottom: 1px solid #eeeef3; }
.wd-brand { color: #5d4dd8; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.wd-kicker { color: #8b8998; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.wd-body { padding: 18px; }
.wd-title { margin: 0; color: #242431; font-size: 21px; line-height: 1.2; }
.wd-subtitle { margin: 6px 0 0; color: #787684; font-size: 13px; line-height: 1.45; }
.wd-status { display: inline-flex; align-items: center; gap: 6px; margin-top: 13px; border-radius: 999px; padding: 5px 9px; color: #3d318d; background: #efedff; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
.wd-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #6a56dd; }
.wd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 17px; }
.wd-stat { border-radius: 11px; padding: 11px 12px; background: #f6f5fa; }
.wd-stat-label { display: block; color: #8b8998; font-size: 11px; }
.wd-stat-value { display: block; margin-top: 3px; color: #29283a; font-size: 16px; font-weight: 750; }
.wd-list { display: grid; gap: 8px; margin-top: 17px; }
.wd-list-title { margin: 0 0 8px; color: #787684; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.wd-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #ecebf2; border-radius: 10px; padding: 11px 12px; background: #fff; }
.wd-row-copy { min-width: 0; }
.wd-row-title { display: block; overflow: hidden; color: #29283a; font-size: 13px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.wd-row-meta { display: block; margin-top: 3px; color: #8b8998; font-size: 11px; }
.wd-column { margin-top: 16px; }
.wd-column-heading { display: flex; align-items: center; justify-content: space-between; color: #787684; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
.wd-column-count { border-radius: 999px; padding: 2px 7px; background: #f0eff5; color: #777487; }
.wd-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.wd-button { border: 0; border-radius: 9px; padding: 8px 11px; color: #fff; background: #5d4dd8; cursor: pointer; font: inherit; font-size: 12px; font-weight: 750; }
.wd-button.secondary { border: 1px solid #dedce8; color: #5d4dd8; background: #fff; }
.wd-button:disabled { cursor: default; opacity: .55; }
.wd-empty { margin-top: 14px; border-radius: 10px; padding: 13px; color: #8b8998; background: #f6f5fa; font-size: 12px; }
.wd-inbox-group { margin-top: 16px; }
.wd-badge { flex: 0 0 auto; border-radius: 999px; padding: 4px 7px; color: #5d4dd8; background: #efedff; font-size: 10px; font-weight: 800; text-transform: uppercase; }
.wd-badge.failed, .wd-badge.needs_attention { color: #b04b36; background: #fff0eb; }
.wd-badge.waiting { color: #8a631d; background: #fff7df; }
.wd-badge.active { color: #2c7b5b; background: #e9f8f0; }
.wd-error { color: #b04b36; font-size: 12px; }
@media (max-width: 420px) { .wd-card { padding: 8px; } .wd-body { padding: 14px; } }
`;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const titleize = (value: unknown) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function relativeDate(value: unknown) {
  const date = new Date(String(value ?? "")).getTime();
  if (!Number.isFinite(date)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const asRecord = (value: unknown): Record<string, any> => (value && typeof value === "object" ? (value as Record<string, any>) : {});

function renderTask(output: unknown) {
  const detail = asRecord(output);
  const task = asRecord(detail.task);
  const sessions = Array.isArray(detail.sessions) ? detail.sessions : [];
  const artifacts = Array.isArray(detail.artifacts) ? detail.artifacts : [];
  const taskId = String(task.id ?? "");
  const latest = asRecord(detail.latestArtifact);
  const sessionNames = sessions.slice(0, 3).map((session) => `${escapeHtml(session.name)} · ${escapeHtml(titleize(session.role))}`).join("<br>");
  return `<div class="wd-shell"><div class="wd-header"><span class="wd-brand">WorkDeck</span><span class="wd-kicker">Current task</span></div><div class="wd-body"><h1 class="wd-title">${escapeHtml(task.title || "Task")}</h1><p class="wd-subtitle">${escapeHtml(asRecord(detail.project).name || "Workspace")} · updated ${escapeHtml(relativeDate(task.updatedAt))}</p><span class="wd-status"><span class="wd-status-dot"></span>${escapeHtml(titleize(task.status || "unknown"))}</span><div class="wd-grid"><div class="wd-stat"><span class="wd-stat-label">Priority</span><span class="wd-stat-value">${escapeHtml(titleize(task.priority || "medium"))}</span></div><div class="wd-stat"><span class="wd-stat-label">Sessions</span><span class="wd-stat-value">${sessions.length}</span></div><div class="wd-stat"><span class="wd-stat-label">Artifacts</span><span class="wd-stat-value">${artifacts.length}</span></div><div class="wd-stat"><span class="wd-stat-label">Latest</span><span class="wd-stat-value">${escapeHtml(latest.title || "—")}</span></div></div><div class="wd-list"><h2 class="wd-list-title">Assigned sessions</h2>${sessionNames ? `<div class="wd-row"><div class="wd-row-copy"><span class="wd-row-meta">${sessionNames}</span></div></div>` : `<div class="wd-empty">No sessions assigned.</div>`}</div><div class="wd-actions"><button class="wd-button" data-action="handoff" data-task-id="${escapeHtml(taskId)}">Generate handoff</button><button class="wd-button secondary" data-action="follow-up" data-task-id="${escapeHtml(taskId)}">Open in chat</button></div></div></div>`;
}

function renderBoard(output: unknown) {
  const board = asRecord(output);
  const project = asRecord(board.project);
  const columns = Array.isArray(board.columns) ? board.columns : [];
  const active = columns.flatMap((column: any) => (Array.isArray(column.tasks) ? column.tasks : [])).filter((task: any) => ["implementing", "reviewing", "blocked"].includes(task.status));
  const columnMarkup = columns.map((column: any) => {
    const tasks = Array.isArray(column.tasks) ? column.tasks : [];
    return `<div class="wd-column"><div class="wd-column-heading"><span>${escapeHtml(titleize(column.status))}</span><span class="wd-column-count">${tasks.length}</span></div><div class="wd-list">${tasks.length ? tasks.map((task: any) => `<button class="wd-row" data-action="open-task" data-task-id="${escapeHtml(task.id)}"><span class="wd-row-copy"><span class="wd-row-title">${escapeHtml(task.title)}</span><span class="wd-row-meta">${escapeHtml(titleize(task.priority))} · ${escapeHtml(relativeDate(task.updatedAt))}</span></span><span class="wd-badge">${escapeHtml(task.sessions?.total ?? 0)} sessions</span></button>`).join("") : `<div class="wd-empty">No tasks here.</div>`}</div></div>`;
  }).join("");
  return `<div class="wd-shell"><div class="wd-header"><span class="wd-brand">WorkDeck</span><span class="wd-kicker">Mini board</span></div><div class="wd-body"><h1 class="wd-title">${escapeHtml(project.name || "Project")}</h1><p class="wd-subtitle">${columns.reduce((total: number, column: any) => total + (Array.isArray(column.tasks) ? column.tasks.length : 0), 0)} tasks across the delivery path.</p><div class="wd-list"><h2 class="wd-list-title">Active</h2>${active.length ? active.slice(0, 5).map((task: any) => `<div class="wd-row"><span class="wd-row-copy"><span class="wd-row-title">${escapeHtml(task.title)}</span><span class="wd-row-meta">${escapeHtml(titleize(task.status))} · ${escapeHtml(titleize(task.priority))}</span></span></div>`).join("") : `<div class="wd-empty">No active tasks.</div>`}</div>${columnMarkup}</div></div>`;
}

function renderInbox(output: unknown) {
  const items = Array.isArray(asRecord(output).items) ? asRecord(output).items : [];
  const groups = ["needs_attention", "review", "waiting", "active", "failed"];
  const markup = groups.map((type) => {
    const matching = items.filter((item: any) => item.type === type);
    if (!matching.length) return "";
    return `<div class="wd-inbox-group"><div class="wd-column-heading"><span>${escapeHtml(type === "needs_attention" ? "Needs you" : titleize(type))}</span><span class="wd-column-count">${matching.length}</span></div><div class="wd-list">${matching.map((item: any) => `<button class="wd-row" data-action="open-task" data-task-id="${escapeHtml(item.taskId)}"><span class="wd-row-copy"><span class="wd-row-title">${escapeHtml(item.title)}</span><span class="wd-row-meta">${escapeHtml(item.reason)} · ${escapeHtml(relativeDate(item.updatedAt))}</span></span><span class="wd-badge ${escapeHtml(type)}">${escapeHtml(titleize(type))}</span></button>`).join("")}</div></div>`;
  }).join("");
  return `<div class="wd-shell"><div class="wd-header"><span class="wd-brand">WorkDeck</span><span class="wd-kicker">Inbox</span></div><div class="wd-body"><h1 class="wd-title">Needs attention</h1><p class="wd-subtitle">A compact projection of task and session states.</p>${markup || `<div class="wd-empty">Nothing needs attention right now.</div>`}</div></div>`;
}

export function renderWidgetMarkup(mode: WidgetMode, output: unknown) {
  if (mode === "task") return renderTask(output);
  if (mode === "board") return renderBoard(output);
  return renderInbox(output);
}

function structuredOutput(value: unknown) {
  const record = asRecord(value);
  return record.structuredContent ?? value;
}

function fallbackOutput() {
  return window.openai?.toolOutput ?? window.__WORKDECK_TOOL_OUTPUT__ ?? {};
}

async function callHostTool(bridge: McpAppsBridge, bridgeReady: Promise<boolean>, name: string, args: Record<string, unknown>) {
  if (await bridgeReady) return bridge.callTool(name, args);
  if (window.openai?.callTool) return window.openai.callTool(name, args);
  if (window.openai?.sendFollowUpMessage) return window.openai.sendFollowUpMessage(`Use WorkDeck tool ${name} with ${JSON.stringify(args)}.`);
  return undefined;
}

async function sendHostMessage(bridge: McpAppsBridge, bridgeReady: Promise<boolean>, message: string) {
  if (await bridgeReady) {
    await bridge.sendMessage(message);
    return true;
  }
  if (window.openai?.sendFollowUpMessage) {
    await window.openai.sendFollowUpMessage(message);
    return true;
  }
  return false;
}

async function copyText(text: string) {
  if (navigator.clipboard) await navigator.clipboard.writeText(text);
}

export function mountWorkDeckWidget() {
  const root = document.getElementById("root");
  if (!root) return;
  let mode = window.__WORKDECK_WIDGET_MODE__ ?? "board";
  let latestToolInput: unknown;
  let latestToolOutput: unknown;
  const bridge = new McpAppsBridge(window);
  const bridgeReady = bridge.connect();
  const render = (output: unknown) => {
    root.innerHTML = `<style>${style}</style><div class="wd-card">${renderWidgetMarkup(mode, output)}</div>`;
  };
  const renderToolResult = (value: unknown) => {
    const output = structuredOutput(value);
    if (!Object.keys(asRecord(output)).length) return;
    latestToolOutput = output;
    render(output);
  };
  bridge.onToolInput = (params) => {
    latestToolInput = params;
  };
  bridge.onToolResult = renderToolResult;
  render(structuredOutput(fallbackOutput()));

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
    if (!target) return;
    const action = target.dataset.action;
    const taskId = target.dataset.taskId;
    if (!taskId) return;
    if (action === "open-task" || action === "follow-up") {
      void (async () => {
        const sent = await sendHostMessage(bridge, bridgeReady, `Open WorkDeck task ${taskId} and show its Current Task context.`);
        if (sent || !window.openai?.callTool) return;
        mode = "task";
        const result = await callHostTool(bridge, bridgeReady, "task.get", { taskId });
        renderToolResult(result);
      })();
    }
    if (action === "handoff") {
      void callHostTool(bridge, bridgeReady, "handoff.generate", { taskId }).then(async (result) => {
        const markdown = asRecord(structuredOutput(result)).markdown;
        if (typeof markdown === "string") await copyText(markdown);
      });
    }
  });

  window.openai?.subscribe?.((event) => {
    if (!bridge.isConnected) renderToolResult(event);
  });

  void bridgeReady;
  void latestToolInput;
  void latestToolOutput;
}

if (typeof document !== "undefined") mountWorkDeckWidget();
