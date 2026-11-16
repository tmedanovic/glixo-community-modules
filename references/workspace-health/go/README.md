# Workspace Health — Go

This preview is a regular Go WebAssembly contribution using the versioned `glixo:contribution/contribution@1.0.0` guest ABI. It reads only the host-selected workspace handle and a bounded path/size listing. A host-reported truncated listing is presented as a sample; complete totals are emitted only when the broker reports a complete listing. Ignored folders and reparse points are outside broker traversal and therefore outside any totals.

Generate the pinned WIT bindings, then run `go test ./...` for native handler and shared-golden tests: `componentize-go --wit-path wit --world contribution bindings --output generated/wit --format --pkg-name github.com/glixo-community/glixo-contribution-guest-go/generated/wit --export-pkg-name github.com/glixo-community/glixo-contribution-guest-go/generated/wit/export_provider`. Build with the pinned `contribution-go-v1` recipe in `reference.json`. This source preview has not completed installed-host acceptance.
