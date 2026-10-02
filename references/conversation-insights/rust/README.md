# Conversation Insights — rust

This preview is an installed WebAssembly contribution using the versioned `glixo:message-middleware/types@1.0.0` JSON payload over the generic `glixo:contribution/contribution@1.0.0` guest ABI. It is not trusted in-process code.

The observer handles committed-message metadata and completed-provider outcomes. It records bounded numeric, boolean, null, object, and array observations only. It does not request content access, copy message text, or log prompt/response text. Actual token usage is provider-reported; character counts are host estimates labeled as estimates.

Build with the pinned `rust` contribution recipe in `reference.json`. Bind the generated artifact SHA-256 into both manifest digest fields with `node scripts/bind-artifact-digest.mjs` before packaging. Every project remains `preview` until installed-host acceptance is complete.
