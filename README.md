# WorkDeck

WorkDeck is a task-centric control plane for AI-assisted work.

It is designed for projects where multiple ChatGPT, Codex, Claude or local sessions take on different roles—architecture, implementation, review and research—and where commits, pull requests, test runs and documents need to stay connected to the work that produced them.

## Core model

```text
Project
  ├─ Task ──┐
  ├─ Session │ TaskSession assignments carry the per-task role
  └─ Artifact┘
       └──── explicit Task → produces → Artifact ownership
```

The model is intentionally provider-neutral. A Session is a work session, not a hard-coded ChatGPT or Codex object. Relations such as `implements`, `reviews`, `produces`, `depends_on`, `blocks` and `fixes` preserve the delivery graph without turning it into a graph-database dependency.
Relation endpoint semantics are validated in the Domain package. A Task only lists Artifacts with an explicit `Task → produces → Artifact` ownership relation; a shared Session never leaks another Task's Artifacts or activity into the current Task context.

## Current scope

Phase 0.1.1 includes:

- Domain Model with Zod validation
- SQLite persistence with an explicit migration
- Parent/child Tasks and task event history
- Many-to-many Task–Session assignments with a role per assignment
- Task-context isolation for shared Sessions, Artifacts, Relations and Handoffs
- Relation compatibility matrix enforced in the Domain layer
- Recursive parent-cycle protection and idempotent activity events
- Separate Session creation and Task assignment schemas, including role-change events
- Loopback-only API binding for the local single-user app
- PC Workboard grouped by task status
- Task Detail for Sessions, Artifacts, Relations, events and editable handoff context
- Markdown Handoff Generator with architecture decisions, review context, acceptance criteria, constraints and next step
- Seeded AgentDeck demo data

Phase 0.2A adds the first application boundary:

- Stable application DTOs shared by REST, Web and MCP adapters
- Local Streamable HTTP MCP server with project, board, task, inbox, session, artifact, relation and handoff tools
- Optional MCP Apps UI resources for a Current Task card, Mini Board and Inbox
- Standards-first MCP Apps `postMessage` bridge with `window.openai` compatibility fallback
- Host/Origin validation for the local MCP endpoint plus SQLite WAL/busy-timeout dual-process hardening
- Shared `WORKDECK_DB_PATH` between the Web/API process and the MCP process
- Local smoke/contract coverage for MCP discovery, reads, writes, validation and task-context isolation

The app runs locally as a small TypeScript monorepo. There is no PostgreSQL, Redis, queue, connector, multi-user layer or cloud deployment in this phase.

## Local development

Requirements: Node.js 20+ and npm 10+.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port `4100`, and the SQLite file is created at `data/workdeck.db` by default.

Useful commands:

```bash
npm test
npm run typecheck
npm run build
npm run db:migrate
npm run db:seed
npm run dev:mcp
npm run dev:chatgpt
```

Set `WORKDECK_DB_PATH` to use another SQLite file. The database enables foreign keys and removes polymorphic Relations through explicit delete triggers when their Project, Task, Session or Artifact is deleted. The API binds explicitly to `127.0.0.1`; it is not intended to be a LAN service.

## Architecture

```text
packages/domain   →   packages/db
       rules             persistence
              ↘   WorkDeckService   →   packages/app-contracts   →   REST / Web
                                      ↘   apps/mcp               →   MCP Apps UI / ChatGPT
```

The domain package contains the vocabulary, validation schemas and pure Handoff renderer. The database package owns SQLite schema, migrations and repositories. `WorkDeckService` is the application boundary used by both REST and MCP; neither adapter talks to SQLite directly. `packages/app-contracts` maps internal read models to stable DTOs, so provider SDKs and database details stay outside the core model. The local MCP server and API both bind to loopback and can share one `WORKDECK_DB_PATH`.

## Future roadmap

These are intentionally not implemented yet:

```text
Phase 0.2B  GitHub integration
Phase 0.3   Agent session automation
Phase 0.4   Mobile companion
```

## Known limitations

- Status changes use select controls; drag-and-drop is intentionally deferred.
- Relations are displayed as a list. A graph view is out of scope.
- Sessions and Artifacts are entered manually; no connector synchronizes external systems yet.
- This is a single-user, local-only board.
- The MCP endpoint is local-only in this prototype. A remote ChatGPT connection needs a separately configured HTTPS endpoint or Secure MCP Tunnel; no public exposure or authentication platform is included yet.
