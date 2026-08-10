---
name: memory-inspector
description: Use the memory inspector to review everything saved to agent memory before re-deriving facts.
metadata:
  extensionId: glixo.samples.memory-inspector
  scopes: [user, workspace, project, session]
---

# Memory Inspector

Review what the agent has already saved to memory before you re-ask the user or
re-derive something. The inspector is **read-only** and secrets are never
returned.

## When to use it

- **Before re-asking the user.** If a fact (a path, a preference, a build
  command, a credential location) might already be saved, check memory first
  instead of asking again.
- **Before re-deriving.** If you are about to recompute or re-discover something
  the agent may have persisted in a previous run, look it up.
- **To confirm what was persisted.** After saving memory, or when the user asks
  "what do you remember?", list the saved entries to verify provenance.

## How to use it

Call the read-only tool `list_saved_memory`. The runtime exposes it namespaced
as `ext__glixo_samples_memory_inspector__list_saved_memory`.

- **Search:** pass `query` with a keyword or phrase to search across every
  memory source.
- **List recent:** omit `query` to list recent entries (default 50, up to 200
  via `limit`).
- **Filter by source:** set `source` to one of `workspace_pack`, `runs_log`,
  `shared_memory`, or `code_note` to look at a single store.
- **Filter by scope:** set `scope` to one of `user`, `workspace`, `project`, or
  `session` to narrow where the memory lives.

Each entry comes back with its provenance (which source and scope it came from)
so you can judge how much to trust it. Secrets are never shown, so do not rely
on this tool to retrieve credentials.

### Examples

- List everything saved for the current workspace:
  `list_saved_memory({ "scope": "workspace" })`
- Find a previously saved build command:
  `list_saved_memory({ "query": "build command" })`
- Review code notes the agent left behind:
  `list_saved_memory({ "source": "code_note", "limit": 20 })`
