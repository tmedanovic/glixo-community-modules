# Go reference

`generated/wit/export_provider/export_glixo_contribution_guest/guest.go` exports the generic contribution WIT `Invoke` adapter and delegates to `mailwatch.Handle`. The handler accepts an injected `httpbroker.Broker` and scoped state. It checks that the invocation has an `oauth` resource slot and passes that slot name to the broker; secret contents never enter guest configuration.

Build the WASM component with the `contribution-go-v1` recipe, which generates bindings before componentization. Run protocol fixtures with `go test ./...`.
