# Teams split inbox extension

**Id:** `glixo.extension.teams-split-inbox`

UI extension - consumes `glixo.messaging.teams` HTTP API. No standalone OS process.

## Implementation reference

Production screen lives in **glixo-playground-app**:

- `standalone/src/extensions/TeamsSplitInboxScreen.tsx`
- Route: `/teams-live` (also registered in `glixo-app.config.json`)

## Install model

Extensions bundle **inside the app repo**, not via Manager. Declare in `glixo-app.config.json` and register screens in `ExtensionRegistry` (`@glixo/sdk`).

Services install separately via Manager -> `glixo.messaging.teams`.
