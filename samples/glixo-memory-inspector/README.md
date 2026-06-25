# Memory Inspector

A read-only Glixo Extension that surfaces everything the agent has saved to
memory. It adds an **Agent Memory** sidebar and a read-only agent tool so you can
see — and search — saved memory with full provenance. Secrets are never
returned.

## What it contributes

- **Sidebar view — "Agent Memory"** (`session.sidebar` slot): a panel that lists
  saved memory for the current session/workspace.
- **Agent tool — `list_saved_memory`**: lists or searches everything the agent
  has saved across the workspace memory pack, per-repo run log, shared/vector
  memory, and `code_remember` notes. Read-only. The runtime exposes it
  namespaced as `ext__glixo_samples_memory_inspector__list_saved_memory`.
- **Skill — "Memory Inspector"** (`skills/memory-inspector`): guidance on when
  and how to use the tool (check memory before re-asking the user or
  re-deriving a fact).

## Permissions and capabilities

Permissions requested:

- **`memory.read`** — read saved memory entries so they can be listed in the
  sidebar and returned by the tool. The Extension never requests write access,
  so it cannot modify or delete memory.

Capabilities required (`requires`):

- **`ui`** — render the Agent Memory sidebar in the client.
- **`capability.glixo.agent.tools.register`** — register the
  `list_saved_memory` agent tool.
- **`capability.glixo.agent.skills.register`** — register the bundled skill.
- **`capability.glixo.memory.read`** — read memory entries.
- **`capability.glixo.memory.search`** — search across memory sources.

In plain language: the Extension can *read and search* saved memory and show it
to you, register one read-only tool plus a skill, and draw a sidebar. It cannot
change anything and it never exposes secrets.

## Install from a local folder

1. In Glixo, open the Extensions catalog and choose **Install from local
   folder** (developer / sideload install).
2. Point it at this directory:
   `samples/glixo-memory-inspector` (the folder containing
   `glixo.module.json`).
3. The installer reads `glixo.module.json`, verifies the artifact in
   `artifacts/glixo-memory-inspector-0.1.0.zip` against the manifest SHA-256,
   and installs the Extension.
4. Accept the runtime policy when prompted, then start the Extension. The
   **Agent Memory** sidebar and the `list_saved_memory` tool become available.
