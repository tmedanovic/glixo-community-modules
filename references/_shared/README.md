# Shared reference assets

This directory holds single-source schemas, golden inputs and expected outputs, shared UI assets, and provenance metadata consumed by language projects. A project can add language adapters; it must not copy or fork the golden meaning.

Golden outputs are test oracles only. Extension examples must compute their response from the invocation, broker grants and approved remote results.

The workspace broker matches a case-insensitive substring against slash-separated relative paths; an empty query returns a bounded listing, not file contents. Search limits are clamped to 1–100, and a truncated listing represents only the returned sample. Guest code sorts results before presenting them. Reads use the invocation's opaque workspace handle and a declared byte limit.

Workspace storage examples use the explicit `workspace-storage/test/` namespace. MCP examples use an approved HTTPS endpoint and the HTTP broker's Streamable HTTP exchange; the session ID is treated as opaque response state and is never selected by guest input. These examples and fixtures do not qualify an external host, endpoint, or account.
