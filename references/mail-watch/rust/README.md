# Rust reference

`src/guest.rs` exports the generic contribution WIT `guest.invoke` adapter and delegates to `handle_mail_watch`. The handler uses the SDK `Broker` and scoped state. It checks the invocation's `oauth` resource slot and passes that declared slot name to the HTTP broker without reading secret contents.

Build the WASM component with the `contribution-rust-v1` recipe. Run protocol fixtures with `cargo test --locked`.
