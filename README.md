# WorkDeck

WorkDeck is a task-centric control plane for AI-assisted work.

It is designed for projects where multiple ChatGPT, Codex, Claude or local sessions take on different roles—architecture, implementation, review and research—and where commits, pull requests, test runs and documents need to stay connected to the work that produced them.

## Core model

```text
Project
  ↓
Task
  ↓
Session
  ↓
Artifact

Relation connects all entities.
```

The model is intentionally provider-neutral. A Session is a work session, not a hard-coded ChatGPT or Codex object. Relations such as `implements`, `reviews`, `produces`, `depends_on`, `blocks` and `fixes` preserve the delivery graph without turning it into a graph-database dependency.

## Current scope

Phase 0.1 includes:

- Domain Model with Zod validation
- SQLite persistence with an explicit migration
- Parent/child Tasks and task event history
- PC Workboard grouped by task status
- Task Detail for Sessions, Artifacts, Relations and events
- Markdown Handoff Generator
- Seeded AgentDeck demo data

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
npm run build
npm run db:migrate
npm run db:seed
```

Set `WORKDECK_DB_PATH` to use another SQLite file. The database enables foreign keys and removes polymorphic Relations through explicit delete triggers when their Project, Task, Session or Artifact is deleted.

## Architecture

```text
packages/domain   →   packages/db   →   packages/api   →   apps/web
    rules              persistence       application       UI adapter
```

The domain package contains the vocabulary, validation schemas and pure Handoff renderer. The database package owns SQLite schema, migrations and repositories. The API package composes repositories into task-centric read models. The React app only talks to HTTP endpoints and does not know about SQLite or provider SDKs.

## Future roadmap

These are intentionally not implemented in Phase 0.1:

```text
Phase 0.2  GitHub integration
Phase 0.3  MCP server
Phase 0.4  ChatGPT App
Phase 0.5  Agent session automation
Phase 0.6  Mobile companion
```

## Known limitations

- Status changes use select controls; drag-and-drop is intentionally deferred.
- Relations are displayed as a list. A graph view is out of scope.
- Sessions and Artifacts are entered manually; no connector synchronizes external systems yet.
- This is a single-user, local-only board.
