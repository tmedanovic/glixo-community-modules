# TypeScript guest SDK

The `@glixo/extension-sdk` source package contains broker, state, logging, workspace, guest-envelope, and LLM event helpers. `NdjsonStream` operates on WIT broker bytes, keeps response lines bounded, and does not call `fetch` or Node networking APIs. Adapters must implement the interfaces with generated Jco imports.

The npm package is source-only in this checkout and has not been published. CLI-generated projects vendor this folder at `vendor/glixo-extension-sdk` until a public npm release is qualified.
