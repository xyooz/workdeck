# OpenAI Apps SDK and MCP references

Checked on 2026-09-09 for WorkDeck Phase 0.2A. This prototype uses the official MCP protocol and OpenAI's current MCP/App guidance, while keeping all provider-facing code outside the WorkDeck domain model.

## Sources

- [Build an MCP server — OpenAI](https://developers.openai.com/plugins/build/mcp-server) — current OpenAI guidance for using the official TypeScript MCP SDK, declaring tools with input/output schemas and safety annotations, returning structured tool output, and testing with MCP Inspector.
- [Build a ChatGPT UI — OpenAI](https://developers.openai.com/plugins/build/chatgpt-ui) — current guidance for optional MCP Apps UI resources, the `text/html;profile=mcp-app` resource MIME type, the `ui://` resource URI, the `ui/*` bridge and the compatibility `openai/outputTemplate` metadata key.
- [Secure MCP Tunnel — OpenAI](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) — guidance for connecting a private local MCP server to supported OpenAI products through an outbound HTTPS tunnel during developer-mode testing; it is not a substitute for a public production endpoint.
- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview) — the MCP extension specification for interactive HTML resources rendered in a sandboxed iframe and connected through the MCP Apps JSON-RPC bridge.
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — upstream SDK source and release guidance.

## Decisions recorded in this branch

### SDK adapter boundary

The OpenAI MCP build guide uses `@modelcontextprotocol/sdk` in its TypeScript example, so WorkDeck uses `@modelcontextprotocol/sdk@1.30.0` in `apps/mcp` only. The upstream SDK repository now documents the v2 line while continuing v1 maintenance for the compatibility window; keeping the dependency behind the MCP adapter gives WorkDeck a contained upgrade path without contaminating `packages/domain` or `packages/db`.

### Stable contracts

MCP handlers call `WorkDeckService`, then map results through `packages/app-contracts`. They never access SQLite or return database rows, migration records or provider SDK objects. Every successful tool returns `structuredContent` plus a short text representation so both model-facing and UI-facing consumers have a stable result.

### UI resources are optional

`board.get`, `task.get` and `inbox.get` advertise `ui://` resources using the current nested `ui.resourceUri` metadata and also include `openai/outputTemplate` for compatibility with existing OpenAI clients. The same tools remain useful without rendering a widget, and the structured payload is always retained. The local UI bundle is self-contained and does not load a remote script.

The UI now uses a standards-first bridge in `apps/chatgpt-ui/src/bridge.ts`: it performs `ui/initialize`, acknowledges with `ui/notifications/initialized`, consumes `ui/notifications/tool-input` and `ui/notifications/tool-result`, proxies server calls with `tools/call`, and sends chat actions with `ui/message`. The adapter imports `LATEST_PROTOCOL_VERSION` and the request types from `@modelcontextprotocol/ext-apps@1.7.5`; `window.openai` is consulted only when the standard bridge is unavailable, preserving compatibility without making the widget ChatGPT-specific. The raw bridge remains intentionally small because the official package's full `App` class is not needed for this guest-side adapter.

### Local MCP request protection

The MCP Express app uses the official SDK `localhostHostValidation()` middleware for DNS-rebinding protection. It also rejects non-loopback browser Origins by default instead of reflecting arbitrary Origins. `MCP_ALLOWED_ORIGINS` is only a comma-separated allowlist for Origins on the local HTTP boundary; it is not a Secure MCP Tunnel requirement and does not add authentication or authorization. When using a tunnel, do not assume a ChatGPT browser Origin reaches the loopback server directly. Leave the variable unset unless the tunnel's local request path actually includes an Origin that needs an exact allowlist entry.

### Shared SQLite reliability

Every `WorkDeckDatabase` connection sets `busy_timeout = 5000`. File-backed databases use WAL mode so the API and MCP processes can read concurrently while SQLite still serializes writes. The Phase 0.2A regression suite opens independent connections, exercises REST→MCP and MCP→REST visibility, and runs concurrent short writes in separate Node processes.

### Local security posture

The API and MCP server bind to `127.0.0.1`. The prototype has no public endpoint, OAuth flow, account model or authentication platform. It uses one SQLite file selected by `WORKDECK_DB_PATH`; the web/API process and MCP process can therefore observe the same local state without introducing a second source of truth.

### Deferred platform integration

This phase does not depend on a ChatGPT conversation ID, dispatch external Codex work, ingest provider history, connect GitHub or expose the endpoint publicly. A future ChatGPT developer-mode test may use `tunnel-client` with Secure MCP Tunnel, which provides a separate outbound connection path while the local MCP server remains private. Production/public integration will require the separate HTTPS and authentication work described by the official OpenAI documentation.
