# Teams split inbox plugin

**Id:** `glixo.plugin.teams-split-inbox`

UI plugin — consumes `glixo.messaging.teams` HTTP API. No standalone OS process.

## Implementation reference

Production screen lives in **glixo-playground-app**:

- `standalone/src/plugins/TeamsSplitInboxScreen.tsx`
- Route: `/teams-live` (also registered in `glixo-app.config.json`)

## Install model

Plugins bundle **inside the app repo**, not via Manager. Declare in `glixo-app.config.json` and register screens in `PluginRegistry` (`@glixo/sdk`).

Services install separately via Manager → `glixo.messaging.teams`.
