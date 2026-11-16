# Rust v3 secret and request-scoped HTTP conformance guest

This source-only fixture exercises the installed Rust guest against the current `provider-compat@3.0.0` and `http/broker@3.0.0` WIT. It sends one POST through an invocation-issued endpoint handle and asks the host to inject the `apiKey` secret into the authorization header. The guest never receives the secret value and has no ambient network client.

The fixture is an independent test crate; it does not change `references/ollama-provider/rust`'s authoring manifest or build recipe. The public Rust Ollama example remains the advertised `guest-v3` implementation. The application server test builds this crate with its exact lockfile and the same pinned Rust toolchain and SDK, then uses the result only for host authorization tests.

The `cdylib` imports the same `../../rust/wit` package used by the Rust Ollama guest and the same pinned `wit-bindgen` and Rust SDK dependencies. Build this crate with `cargo build --locked --manifest-path references/ollama-provider/qualification/rust-secret-http-v3/Cargo.toml --lib --target wasm32-wasip2` and an isolated `--target-dir`.
