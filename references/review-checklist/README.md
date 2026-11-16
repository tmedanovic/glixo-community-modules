# Extension review checklist

This checklist is runtime-free. It helps reviewers inspect a package and keep source/build evidence separate from installed-host acceptance.

## Source and contract

- Confirm the source commit, contribution IDs, language, and declared guest-contract revision.
- Validate manifest v2, contribution schemas, configuration schemas, events, and all declared artifacts against the public contract and SDK versions.
- Confirm every declared export exists and its input/output schemas match the host registration.
- Confirm source projects contain real behavior. Goldens are test expectations, not runtime fixtures or canned responses.

## Capabilities and data scope

- Review requested grants against the minimum behavior the contribution needs.
- Confirm workspace reads use host-issued project/file handles and cannot select arbitrary paths.
- Confirm network calls use approved endpoint handles and enforce scheme, host, method, path, redirect, response-size, timeout, and cancellation rules.
- Confirm secrets stay in host-managed slots and logs omit credentials and private prompts.
- Confirm storage scope is isolated by host-stamped account, app, package, contribution, and test namespace.
- Confirm MCP transport uses an explicitly approved remote HTTPS transport; no stdio, arbitrary process, or ambient network fallback.

## Runtime and failure behavior

- Build the exact declared C#, Go, Rust, and TypeScript components with pinned compilers and dependencies.
- Run shared contract goldens and the project's meaningful language-level tests.
- Inspect cancellation, deadlines, size limits, retries, idempotency, concurrency, and error handling.
- Confirm user data, tool authority, identity, grant state, or approval cannot be forged in guest inputs or outputs.
- For event sources, check checkpoint persistence, duplicate delivery, replay, revocation, and account isolation.

## Host acceptance evidence

Record the host version, OS/platform, source SHA, artifact digests, installation path, grants, activation, invoked contribution, and observable application result. Mark each host matrix cell as passed, blocked, or untested; do not infer host acceptance from a successful compiler or fixture harness.

Keep separate evidence for:

- Source review and static validation.
- Component compilation and contract tests.
- Local host installation and invocation.
- External service/account acceptance.
- Signing, publication, and production release.

An artifact digest detects content changes; it does not identify an admitted signer. A local package build does not prove marketplace admission, install, activation, or release.
