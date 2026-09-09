# WorkDeck Phase 0.1 architecture

The data model keeps the core entities normalized and leaves cross-entity semantics in `relations`:

| Entity | Owns | Cross-entity links |
| --- | --- | --- |
| Project | name and description | contains Tasks, Sessions and Artifacts through `project_id` |
| Task | status, priority, hierarchy and history | `parent_task_id`, Relations, TaskEvents |
| Session | provider-neutral AI/local work context | zero or more Task assignments; Relations can connect it to any entity |
| TaskSession | Task–Session association | stores the role and assignment timestamps for one Task/Session pair |
| Artifact | durable result metadata | explicit `Task → produces → Artifact` ownership plus Session Relations |
| Relation | source/target entity ids and semantic type | polymorphic and provider-neutral |

SQLite foreign keys protect owned records. Since Relations are polymorphic, four delete triggers explicitly remove links when an entity disappears. `task_events` records changes that would otherwise be lost when only the current Task row is inspected.

The API read model enriches a Task with directly assigned Sessions, explicitly owned Artifacts, context-scoped Relations and event history. A shared Session's Relations are included only when both Relation endpoints have the current Task in their context; this prevents a long-lived Chat from leaking another Task's Artifacts or review activity into the current Handoff.

## 0.1.1 hardening decisions

- `sessions` no longer stores `task_id` or `role`. The `task_sessions` join table stores one role per Task–Session assignment, allowing a long-lived Chat to be an architect on one Task and a reviewer on another.
- Migration 2 upgrades the original single-task rows into `task_sessions` while preserving their role and timestamps.
- Migration 3 expands the TaskEvent check constraint with `session_role_changed`.
- Migration 4 backfills explicit `Task → produces → Artifact` ownership from legacy `artifact_attached` events without creating new activity events.
- `CreateSessionInputSchema` creates only a Session. `AssignSessionToTaskInputSchema` owns the `taskId`, `sessionId` and per-assignment `role` fields.
- The Relation compatibility matrix is enforced before persistence: `Session → Task` for `defines`/`implements`/`reviews`, `Session → Artifact` for `reviews`/`produces`, `Task → Artifact` for `produces`, Task-to-Task workflow links, Session-to-Session continuation and Artifact/Task derivation.
- Parent changes use a guarded recursive CTE to reject any ancestor cycle before the write.
- Relation and artifact attachment writes inspect SQLite changes before emitting activity, so idempotent requests do not fabricate timeline events. Contextual Relations update and emit activity only for the intersection of their endpoint contexts; direct Task endpoints remain scoped to those endpoint Tasks.
- The API explicitly listens on `127.0.0.1`.
- CORS is limited to the local web origin `http://127.0.0.1:5173`, and the Vite API proxy uses the same IPv4 loopback address.
