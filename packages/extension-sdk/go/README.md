# Go guest SDK

The Go module `github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go` contains broker interfaces and bounded HTTP/NDJSON, state, logging, workspace, guest-envelope, and LLM event helpers. It is distributed from this repository with the nested-module tag `packages/extension-sdk/go/v0.1.0`; it does not have a separate `github.com/glixo/extension-sdk-go` repository. Implement its interfaces with generated WIT imports. The module does not use `net/http`, filesystem access, processes, or ambient credentials.

The supported component route is regular Go with the pinned Bytecode Alliance `componentize-go` tool listed in the root support matrix. No TinyGo fallback is implied.
