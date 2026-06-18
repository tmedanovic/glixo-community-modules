# Teams split inbox plugin

**Kind:** `plugin` — UI only. Requires **`glixo.messaging.teams`** service running.

## What it provides

- Route: `/teams-live` (bundled in app, see `glixo-playground-app`)
- Uses `@glixo/ui` `SplitInboxView` + `TeamsServiceClient`

## Install model

1. Manager installs **service** `glixo.messaging.teams` → starts on `:6120`
2. App bundles or Manager installs **plugin** `glixo.plugin.teams-split-inbox`
3. Plugin reads `teamsServiceUrl` from module config

Third-party apps can skip this plugin and build their own UI against the same service HTTP API.
