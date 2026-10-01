# Glixo extension references

This repository is the public source for maintained Glixo extension-author references. The active tree contains executable teaching projects and shared, versioned assets. Git history retains the retired module-v0 catalog and adapter examples; they are not part of the current authoring path.

- Extension authoring tool: `glxdev` (see the public SDK and developer docs)
- Supported contribution package contract: manifest v2 with versioned guest contracts and SDK assets shipped beside these references
- Reference languages: C#, Go, Rust, and TypeScript
- Marketplace: none of the teaching projects is listed or installable

`glixo.extension.json` describes the guest extension manifest (schema v2). The host-install distribution envelope is generated separately by the current `glxdev` tooling; it is not a guest module descriptor. Historical module-v0 descriptors in Git history are not accepted by these projects.

## References

| Reference | What it teaches | Executable projects |
| --- | --- | --- |
| `ollama-provider` | Connect to a user-approved Ollama endpoint, discover models, stream chat, and handle tool calls | C#, Go, Rust, TypeScript |
| `workspace-health` | Read host-scoped workspace facts and report actionable health findings | C#, Go, Rust, TypeScript |
| `document-index` | Search host-authorized project files and return bounded results with provenance | C#, Go, Rust, TypeScript |
| `workspace-storage` | Store and retrieve values through an approved test namespace | C#, Go, Rust, TypeScript |
| `issue-lookup-mcp` | Use the approved HTTPS Streamable HTTP MCP transport to look up issues | C#, Go, Rust, TypeScript |
| `mail-watch` | Poll Microsoft Graph Inbox delta metadata and publish idempotent events | C#, Go, Rust, TypeScript |
| `conversation-insights` | Report message and tool-use statistics without logging prompts | C#, Go, Rust, TypeScript |
| `prompt-redactor` | Preview and apply explicitly configured outbound redactions | C#, Go, Rust, TypeScript |
| `accessible-theme` | Share accessible semantic theme tokens and contrast fixtures | Shared assets; no guest runtime |
| `review-checklist` | Review extensions without executing package code | Shared checklist; no guest runtime |

Reference status and source/toolchain evidence are in [`references/reference-index.json`](references/reference-index.json). A listed project is not a claim of host acceptance: each row identifies the source implementation and its current contract status. Public repository CI builds each implemented guest target and runs its contract checks; real host installation, provider, Microsoft Graph, and platform acceptance remain separately reported.

## Layout

```text
references/
  <reference-id>/{csharp,go,rust,typescript}/  Complete, runnable guest projects
  _shared/                                    Versioned UI, schemas and goldens
  reference-index.json                        Inventory and support evidence
packages/extension-sdk/support-matrix.json   Single source for SDK and compiler pins
scripts/verify-references.mjs                 Inventory, provenance and stale-tree checks
```

No active `bundled/`, `catalog/`, native-process adapter, stdio MCP, or placeholder-echo category is maintained here. Historical recovery belongs in Git history, not an archive folder.

## Build and validate

Install the pinned toolchains from `packages/extension-sdk/support-matrix.json`, then run the per-project commands in each project's `README.md`. From the repository root:

```powershell
npm run verify
npm run build:references
```

A successful build means the source projects compile and pass their declared host-independent contract checks. It does not claim that a Glixo host is available, an extension is signed, a package is published, or an external account/provider accepted the integration.

## Use with glxdev

Create a package from the matching contribution template with a `glxdev` version that supports the indexed manifest and recipe, then copy the project source and the public SDK version pinned by this repository. The consuming application records the public source commit and each template tree hash in its lock file. Update templates only from a full public Git SHA and verify the included hashes. Do not copy from an unpinned branch or make a release/publishing claim from a local build.

## License and attribution

New reference source and shared fixtures are released under the MIT License in [`LICENSE`](LICENSE), unless a reference directory includes its own third-party notice. Upstream API names and product marks belong to their respective owners. Microsoft Graph, Ollama, MCP and Glixo are cited only as interoperability targets; this repository does not imply endorsement.
