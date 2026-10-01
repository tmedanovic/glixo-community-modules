# Go guest SDK

The Go module `github.com/glixo/extension-sdk-go` contains broker interfaces and bounded HTTP/NDJSON, state, logging, workspace, guest-envelope, and LLM event helpers. Implement its interfaces with generated WIT imports. The module does not use `net/http`, filesystem access, processes, or ambient credentials.

The supported component route is regular Go with the pinned Bytecode Alliance `componentize-go` tool listed in the root support matrix. No TinyGo fallback is implied.
