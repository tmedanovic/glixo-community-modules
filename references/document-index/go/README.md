# Document Index — Go

This preview is a regular Go WebAssembly contribution using the versioned `glixo:contribution/contribution@1.0.0` guest ABI. It searches relative workspace paths through the selected host-issued handle, sorts matches by UTF-8 byte order, and reads at most 4 KiB from each matching file. Excerpts are capped at 96 UTF-8 bytes without splitting a code point; files larger than the read cap receive a null excerpt and are not read.

Generate the pinned WIT bindings, then run `go test ./...` for native handler and shared-golden tests: `componentize-go --wit-path wit --world contribution bindings --output generated/wit --format --pkg-name github.com/glixo-community/glixo-contribution-guest-go/generated/wit --export-pkg-name github.com/glixo-community/glixo-contribution-guest-go/generated/wit/export_provider`. Build with the pinned `contribution-go-v1` recipe in `reference.json`. This source preview has not completed installed-host acceptance.
