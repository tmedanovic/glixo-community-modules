# Prompt Redactor — rust

This preview is an installed WebAssembly contribution using the versioned `glixo:message-middleware/types@1.0.0` JSON payload over the generic `glixo:contribution/contribution@1.0.0` guest ABI. It is not trusted in-process code.

The transformer applies ordered, case-sensitive literal replacements to eligible outgoing user text and returns only text patches for the provider request; stored transcript content remains unchanged. Host-owned roles, authority, tools, attachments, tool-call/result relationships, approvals, credentials, and provider identity are outside the patch format. The install requests both `message.content.read` and `message.input.transform`; both must be current for this hook. A mandatory transformer failure blocks provider submission. Preview uses the same pure transform logic without submitting to a provider; the host preview UI remains pending acceptance.

Build with the pinned `rust` contribution recipe in `reference.json`. Bind the generated artifact SHA-256 into both manifest digest fields with `node scripts/bind-artifact-digest.mjs` before packaging. Every project remains `preview` until installed-host acceptance is complete.
