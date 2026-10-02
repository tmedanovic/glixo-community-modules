# Workspace Health — Rust

This preview is a regular Rust WebAssembly contribution using the versioned `glixo:contribution/contribution@1.0.0` guest ABI. It reads only the host-selected workspace handle and a bounded path/size listing. A host-reported truncated listing is presented as a sample; complete totals are emitted only when the broker reports a complete listing. Ignored folders and reparse points are outside broker traversal and therefore outside any totals.

Run `cargo test --locked` for native handler and shared-golden tests. Build through the pinned `contribution-rust-v1` recipe in `reference.json`, then copy the recipe artifact into `dist/glixo-extension.component.wasm` with `node scripts/copy-artifact.mjs`. This source preview has not completed installed-host acceptance.
