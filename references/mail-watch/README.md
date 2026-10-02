# Mail Watch reference

Mail Watch is a bounded, scheduled Glixo background service that watches the signed-in account's Inbox with Microsoft Graph's message delta endpoint. Setup requires delegated Microsoft Graph `Mail.ReadBasic` consent for the account. Its initial delta run establishes a cursor without reporting historical messages. Later wakes emit `mail.received` account events containing message ID, receive time, and optional sender address. The service does not request message bodies, invoke an LLM, send email, or make ambient network calls; full message content would require a separate permission and is not part of this reference.

Each language implementation exports the generic `glixo:contribution/guest@1.0.0` `guest.invoke` entrypoint and accepts the `backgroundServices` request with lifecycle operations `initialize`, `wake`, `health`, and `stop`. HTTP calls go through the injected Glixo Extension SDK broker, and the bearer token is referenced only by the invocation-scoped `oauth` secret slot. The guest returns its opaque delta cursor as a checkpoint and repeatable message idempotency keys; the installed host commits the checkpoint and event outbox together before at-least-once publication with durable duplicate suppression.

`manifest.fragment.json` shows the requested capabilities and scheduled contribution. `configuration.schema.json` requires the protected account OAuth slot (`oauth`) for delegated Microsoft Graph `Mail.ReadBasic` access and bounds `maxPagesPerWake`. The host injects only an invocation-scoped lease handle; the guest never reads token contents. The credential remains in Glixo's protected configuration and is never stored in this source tree or passed as a guest configuration value. Users must explicitly activate the service and grant its declared permissions. The source does not claim that a real Microsoft account has been connected.

Each language project now contains a generic WIT adapter, v2 extension manifest, project metadata, and a `contribution-<language>-v1` component recipe. The references build unsigned WASM components; this does not constitute a signed or catalog-admitted package. Account activation requires explicit `service.activate` consent, a verified account configuration with the `oauth` slot, the declared Graph and event grants, and the normal package verification flow. No live Graph credentials or mail account were available for this run, so real Microsoft Graph delivery remains unverified.

## Validation

Run the language project's `reference.json` build recipe and contract checks. The tests inject a fake broker and cover initial delta suppression, continuation links, metadata-only events, repeatable event keys, origin/path rejection, lifecycle calls without Graph credentials, and response cleanup. They perform no network requests. Installed-host qualification and real-mail acceptance are tracked separately from source/component builds.

## Framed host fixture

`host-fixture.json` defines bounded generic `guest.invoke` requests for the four language references. The health case performs no HTTP call. The initialization, wake, and replay cases use exact Microsoft Graph Inbox delta URLs and fixture-only metadata; a framed host driver must match each route and mint an ephemeral opaque `oauth` lease handle. It must not resolve DNS, open a socket, or provide token material.

The replay case verifies that each guest returns the same stable event idempotency key. Durable outbox deduplication is exercised separately by `InstalledBackgroundServiceRuntimeTests`. The hostile-cursor case expects rejection before any broker request. These fixtures prove generic guest behavior through the host protocol; they do not prove mailbox consent or live Graph access.
