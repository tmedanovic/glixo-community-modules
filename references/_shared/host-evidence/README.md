# Host evidence records

These records pin the runtime, framed driver, component digests, and the scope of each observed check. Artifact paths are repository-relative expected build outputs; component binaries are not checked into this source tree.

`binarySourceSnapshot` identifies the public reference source used to build a recorded component. `currentManifestSnapshot` identifies the public tree used by the current source catalog and verifier. Metadata-only edits after a build do not imply that the component was rebuilt.

Fixture-backed framed calls, installed-host journeys, local live backends, and remote/live service acceptance are reported separately. A fixture pass does not qualify the installed package path or a live external service. A loopback Ollama inference pass is local-backend evidence and does not establish installed approval UX or remote endpoint support. Mail Watch's persisted installed scheduler fixture is TypeScript-only; it does not qualify a live Microsoft Graph mailbox.

Run `npm run verify:evidence` to check the records for portable paths, full source/runtime/driver identities, artifact digests and sizes, and explicit fixture boundaries.
