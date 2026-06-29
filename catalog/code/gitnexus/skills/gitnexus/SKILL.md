---
name: gitnexus
description: Use when repository structure, symbols, call graphs, dependency impact, or blast radius matter and GitNexus MCP tools are available.
---

# GitNexus

Use GitNexus when the user asks questions that depend on indexed repository
structure rather than only literal text:

- where a symbol, endpoint, class, component, or database table is used
- what code calls or depends on another unit
- impact or blast-radius analysis before changing a shared function
- repository architecture questions that need graph context

Prefer the `mcp__gitnexus__*` tools when they are connected. If the tools are
not connected, tell the user the GitNexus extension needs to be installed and
enabled for the session.

If results look empty or stale, ask the user to refresh the index from the
repository root:

```powershell
npx gitnexus@1.6.5 analyze .
```

GitNexus reads its registry from the user's home directory, so a single
`gitnexus` MCP server can serve multiple indexed repositories. Keep normal code
tools in the loop: use GitNexus to orient on graph relationships, then read the
actual files before editing.
