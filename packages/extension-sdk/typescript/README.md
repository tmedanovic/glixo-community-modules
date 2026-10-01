# TypeScript guest SDK

The `@glixo/extension-sdk` source package contains broker, state, logging, workspace, guest-envelope, and LLM event helpers. `NdjsonStream` operates on WIT broker bytes, keeps response lines bounded, and does not call `fetch` or Node networking APIs. Adapters must implement the interfaces with generated Jco imports.

The npm package is source-only in this checkout and has not been published. CLI-generated projects vendor this folder at `vendor/glixo-extension-sdk` until a public npm release is qualified.

## Jco `result` errors

Jco maps a top-level WIT `result<T, string>` import to `T` on success and throws on the `err` arm; an `option<T>` is `T | undefined`. WIT variants keep their kebab-case tags (for example, `{ tag: "tool-call-details", val: details }`). Do not model these as `{ tag: "ok", val }`, `{ tag: "err", val }`, or `{ tag: "none" }`.

Use `captureWitResult(() => generatedImport(...))` to adapt a generated import to the SDK's internal `Result<T>` type. At an exported function whose WIT signature returns `result<T, string>`, catch internal errors and call `throwWitError(error)`; throwing an `Error` object traps instead of returning the WIT error arm. The helper bounds error payloads to 256 characters.
