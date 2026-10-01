# Ollama LLM provider (csharp)

C#/.NET 10 WASI Component Model guest built by componentize-dotnet. Uses the v3 provider WIT imports and Glixo HTTP broker only; it has no ambient network client. Toolchain availability is not host or release qualification. The support matrix keeps this language at Preview while the installed-host and live Ollama gates remain open.

The provider configuration selects the host-approved `ollama` endpoint and may select a default model. The host resolves the approved base URL and issues a request-scoped opaque endpoint handle. A guest URL does not grant authority: the host checks each request against the endpoint handle and the installed manifest's method/path grants.

Model discovery uses GET `/api/tags`. Per-model capabilities come from POST `/api/show` with `{ "model": "..." }`; tools, vision, and thinking are advertised or sent only when the selected model's returned capability list supports them. Chat uses POST `/api/chat` with NDJSON streaming. The guest reads records incrementally, maps text, reasoning, tool calls, usage, finish and errors to typed events, and cancels/releases the broker response handle on cancellation or drop.

Run the commands declared by `reference.json` through the pinned recipe in `packages/extension-sdk/support-matrix.json`. Protocol examples under `shared/test-vectors/ollama/` are copied from Ollama's published API documentation; they are not live inference tests.
