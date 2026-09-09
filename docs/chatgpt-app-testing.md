# Local MCP Apps testing

This is the Phase 0.2A local smoke flow. It keeps WorkDeck on loopback and uses the same SQLite file for the Web/API and MCP processes.

## 1. Build the widget bundle

From the repository root:

```bash
npm ci
npm run typecheck
npm run build
```

The MCP server embeds `apps/chatgpt-ui/dist/component.js` when that bundle exists. It falls back to a short “bundle not built” resource if the file is absent.

## 2. Start API and MCP with one database

Use two terminals. The explicit path is useful when testing in isolation:

```bash
export WORKDECK_DB_PATH="/tmp/workdeck-phase-0-2a.db"
npm run dev:api
```

In the second terminal, use the same value:

```bash
export WORKDECK_DB_PATH="/tmp/workdeck-phase-0-2a.db"
npm run dev:mcp
```

The API is available at `http://127.0.0.1:4100`; the MCP endpoint is `http://127.0.0.1:4200/mcp`. Both processes seed the demo project idempotently. Set `PORT` or `MCP_PORT` if either port is already in use.

Quick checks:

```bash
curl http://127.0.0.1:4100/api/health
curl http://127.0.0.1:4200/health
```

For protocol-level inspection, point the official MCP Inspector at `http://127.0.0.1:4200/mcp` after starting the server. Test the read tools first, then exercise writes only against a disposable local database.

## 3. Render the UI locally

In a third terminal:

```bash
npm run dev:chatgpt -- --host 127.0.0.1 --port 5174
```

Open the URL printed by Vite with one of these modes:

- `http://127.0.0.1:5174/?mode=task` — Current Task Card
- `http://127.0.0.1:5174/?mode=board` — Mini Board
- `http://127.0.0.1:5174/?mode=inbox` — Inbox

This page uses deterministic demo data to verify the widget without requiring a ChatGPT host. The MCP resource uses the same compiled component bundle and receives its real tool output through the MCP Apps bridge when a compatible host is present.

## 4. Optional ChatGPT developer-mode test

The local `127.0.0.1` endpoint is not directly a public ChatGPT app endpoint. For a supported developer-mode connection, use an approved HTTPS exposure method such as Secure MCP Tunnel and keep the tunnel scoped to this disposable local server. Do not commit tokens, tunnel credentials or public URLs. Verify tool discovery and read-only rendering before testing mutations.

## 5. Cleanup

Stop the three local processes and remove only the disposable database path you selected for this test. The repository's normal `data/` database is not required for the test flow.
