# Document Index — Rust

This preview is a regular Rust WebAssembly contribution using the versioned `glixo:contribution/contribution@1.0.0` guest ABI. It searches relative workspace paths through the selected host-issued handle, sorts matches by UTF-8 byte order, and reads at most 4 KiB from each matching file. Excerpts are capped at 96 UTF-8 bytes without splitting a code point; files larger than the read cap receive a null excerpt and are not read.

Run `cargo test --locked` for native handler and shared-golden tests. Build through the pinned `contribution-rust-v1` recipe in `reference.json`, then copy the recipe artifact into `dist/glixo-extension.component.wasm` with `node scripts/copy-artifact.mjs`. This source preview has not completed installed-host acceptance.
