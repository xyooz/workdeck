export type JsonRpcId = number | string;

type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export class McpAppsBridge {
  private readonly parentWindow: Window;
  private readonly embedded: boolean;
  private readonly timeoutMs: number;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextRequestId = 1;
  private connectionPromise: Promise<boolean> | null = null;
  private connected = false;
  private readonly messageHandler = (event: MessageEvent) => this.handleMessage(event);

  onToolInput?: (params: unknown) => void;
  onToolResult?: (params: unknown) => void;

  constructor(private readonly hostWindow: Window, timeoutMs = 1500) {
    this.parentWindow = hostWindow.parent;
    this.embedded = this.parentWindow !== hostWindow;
    this.timeoutMs = timeoutMs;
    if (this.embedded) hostWindow.addEventListener("message", this.messageHandler, { passive: true });
  }

  get isConnected() {
    return this.connected;
  }

  connect() {
    if (!this.embedded) return Promise.resolve(false);
    if (!this.connectionPromise) this.connectionPromise = this.initialize();
    return this.connectionPromise;
  }

  callTool(name: string, args: Record<string, unknown>) {
    return this.request("tools/call", { name, arguments: args });
  }

  sendMessage(text: string) {
    return this.request("ui/message", {
      role: "user",
      content: { type: "text", text },
    });
  }

  dispose() {
    if (this.embedded) this.hostWindow.removeEventListener("message", this.messageHandler);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MCP Apps bridge was disposed"));
    }
    this.pending.clear();
    this.connected = false;
    this.connectionPromise = null;
  }

  private async initialize() {
    try {
      await this.request("ui/initialize", {
        appInfo: { name: "WorkDeck", version: "0.2.0" },
        appCapabilities: { availableDisplayModes: ["inline"] },
      });
      this.connected = true;
      this.notify("ui/notifications/initialized");
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  private notify(method: string, params?: unknown) {
    if (!this.embedded) return;
    this.parentWindow.postMessage({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }, "*");
  }

  private request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.embedded) return Promise.reject(new Error("MCP Apps bridge is unavailable outside an embedded host"));
    if (method !== "ui/initialize" && !this.connected && !this.connectionPromise) {
      return Promise.reject(new Error("MCP Apps bridge is not initialized"));
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP Apps request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      try {
        this.parentWindow.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("MCP Apps request failed"));
      }
    });
  }

  private handleMessage(event: MessageEvent) {
    if (event.source !== this.parentWindow) return;
    const message = asRecord(event.data) as JsonRpcMessage;
    if (message.jsonrpc !== "2.0") return;

    const id = message.id;
    if ((typeof id === "number" || typeof id === "string") && this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      const error = asRecord(message.error);
      if (Object.keys(error).length) {
        pending.reject(new Error(typeof error.message === "string" ? error.message : "MCP Apps host request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "ui/notifications/tool-input") this.onToolInput?.(message.params);
    if (message.method === "ui/notifications/tool-result") this.onToolResult?.(message.params);
  }
}
