# glixo-community-modules

Community **integration modules** extracted from `genie-server` monolith adapters.
Each module is a installable service with its own storage scope — **no shared central DB**.

Naming: **`glixo-community-modules`** (catalog uses `genie.module.json` ids like `glixo.messaging.teams`).

## Modules

| Module | Status | Source in genie monorepo |
|--------|--------|--------------------------|
| [teams](./modules/teams/) | extract pending | `packages/genie-server/sources/modules/integrations/teams/` |
| [whatsapp](./modules/whatsapp/) | extract pending | `packages/genie-agent-vm/whatsapp-bridge/` + server relay |
| [outlook](./modules/outlook/) | extract pending | `integrations/outlook/` |
| [gmail](./modules/gmail/) | extract pending | `integrations/email/gmail*` |
| [google-contacts](./modules/google-contacts/) | extract pending | `integrations/contacts/googleContactsAdapter.ts` |
| [jira](./modules/jira/) | extract pending | `integrations/jira/` |
| [confluence](./modules/confluence/) | extract pending | `integrations/confluence/` |
| [figma](./modules/figma/) | partial | `integrations/figma/httpFigmaAdapter.ts` |
| [github](./modules/github/) | extract pending | `integrations/git/httpGithubAdapter.ts` |
| [gitlab](./modules/gitlab/) | extract pending | `integrations/git/httpGitlabAdapter.ts` |

## Architecture

```text
App (glixo-playground-app)
  └── custom UI (@glixo/ui)
  └── core cell (genie-platform: auth, health, machines, daemon)
  └── installed modules (this repo) — each declares requires: [relationalDb, events, …]
```

Modules talk to the host via **`@glixo/sdk`** (`message.send`, `work.items.*`, events).
Host owns credential vault + capability routing — not a monolith Prisma schema.

## Install into an app (target)

1. Manager catalog scans Git source pointing at this repo
2. Module install runner copies artifact + registers capabilities (WIP in genie-platform)
3. App HomeScreen shows module tile when `status: ok`

See `genie-platform/docs/architecture/MODULE_LIFECYCLE.md`.

## Dev

Each `modules/<name>/` contains:

- `genie.module.json` — manifest stub
- `EXTRACTION.md` — file cut list from genie-server
- `package.json` — Node module entry (to be filled on extract)
