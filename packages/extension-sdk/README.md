# Glixo guest extension SDKs

These SDKs are for untrusted WebAssembly guests. They expose typed helpers for the versioned Glixo WIT imports; they do not provide ambient HTTP, filesystem, process, environment-secret, or native-library access. Network and state operations must be sent through the host broker supplied to the guest world.

The language packages live under `rust/`, `go/`, `typescript/`, and `csharp/`. `wit/` contains the canonical contribution-v1 world, LLM provider-v3 world, their HTTP-v3 dependencies, and the v2 extension-manifest schema. `support-matrix.json` pins toolchains by language and exposes allowlisted build recipes by recipe ID; this allows a language to build different WIT worlds without duplicating compiler pins. Each reference project pins its own recipe ID and contract checks in `reference.json`.

The Ollama provider references under `community-modules/references/ollama-provider/` use native `/api/tags`, `/api/show`, and `/api/chat`. They rely on a host-issued `ollama` endpoint grant and do not accept a raw endpoint URL as guest authority. The host resolves the approved endpoint and binds its opaque handle to each request; the URL field supplied by a guest is data that the host validates against that handle and the installed package's exact method/path permissions.

Contribution helpers take broker implementations from generated WIT imports rather than constructing native transports. Scoped extension state requires the `storage.extension` grant and declared key prefixes; workspace helpers require host-issued resource handles and project-local `fs.workspace.read` or `fs.workspace.search` grants. Workspace byte limits are checked by the host and remain bounded by the WIT operation's `max-bytes` argument.

These are source packages in the monorepo. Their publication and clean-checkout install qualification are separate gates; source availability does not claim a published SDK release.
