# Rust guest SDK

`glixo-extension-sdk` provides broker, state, logging, workspace, guest-envelope, and LLM event helpers. Implement the traits with generated WIT imports from the world's host-provided interfaces. The HTTP helper handles incremental bytes and bounded NDJSON lines; it never opens a socket itself.

The package has no published crate version yet. The source path is copied into CLI-generated projects as `vendor/glixo-extension-sdk` until a public crate release is qualified.
