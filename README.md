# glixo-community-modules

Community **services** and **UI plugins** extracted from `genie-server`.

## Service vs plugin

| Kind | Example | Owns |
|------|---------|------|
| **service** | `glixo.messaging.teams` | DB, auth, sync, events, HTTP API |
| **plugin** | `glixo.plugin.teams-split-inbox` | App routes + `@glixo/ui` screens |

See `genie-platform/docs/architecture/glixo-services-vs-plugins.md`.

## Modules

| Service | Plugin | Status |
|---------|--------|--------|
| [teams](./modules/teams/) | [teams-split-inbox](./plugins/teams-split-inbox/) | **alpha scaffold** — SQLite, auth mock, replay, playground `/teams-live` |
| whatsapp | — | extract pending |
| outlook | — | extract pending |
| … | — | stub manifests |

## Manager install (target)

1. Catalog source → this repo
2. Install `glixo.messaging.teams` → `{GENIE_HOME}/modules/...`
3. Start module process (Manager `ModuleRuntimeSupervisor`)
4. App installs plugin or bundles route

**Gaps today:** real zip artifacts, health polling, migration hook on start, update runner.

## Dev — Teams

```powershell
# Terminal 1 — service
cd modules/teams && yarn install && yarn build && yarn start

# Terminal 2 — playground (expo already running is fine)
cd D:/Projects/glixo-playground-app/standalone
# open /teams-live
```
