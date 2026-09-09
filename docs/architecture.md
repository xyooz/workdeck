# WorkDeck Phase 0.1 architecture

The data model keeps the core entities normalized and leaves cross-entity semantics in `relations`:

| Entity | Owns | Cross-entity links |
| --- | --- | --- |
| Project | name and description | contains Tasks, Sessions and Artifacts through `project_id` |
| Task | status, priority, hierarchy and history | `parent_task_id`, Relations, TaskEvents |
| Session | provider-neutral AI/local work context | optionally assigned to one Task; Relations can connect it to any entity |
| Artifact | durable result metadata | Relations connect it to the producing/reviewing work |
| Relation | source/target entity ids and semantic type | polymorphic and provider-neutral |

SQLite foreign keys protect owned records. Since Relations are polymorphic, four delete triggers explicitly remove links when an entity disappears. `task_events` records changes that would otherwise be lost when only the current Task row is inspected.

The API read model enriches a Task with directly assigned Sessions, Artifacts produced by those Sessions, Relations and event history. This keeps the Workboard useful without introducing a separate graph database.
