# glixo-community-modules

Community **extensions** for Glixo. Public product language is "extensions";
`service`, `plugin`, and `component` are implementation roles declared inside
`genie.module.json`.

See `genie-platform/docs/architecture/GLIXO_PLATFORM_PLUGIN_SYSTEM.md`.

## Modules

| Service | Plugin | Status |
|---------|--------|--------|
| [teams](./modules/teams/) | [teams-split-inbox](./plugins/teams-split-inbox/) | **alpha scaffold** — SQLite, auth mock, replay, playground `/teams-live` |
| whatsapp | — | extract pending |
| outlook | — | extract pending |
| … | — | stub manifests |

## Manager install target

1. Add this repo as a catalog source (`localFolder` or `git`)
2. Install an extension such as `glixo.messaging.teams` to `{GENIE_HOME}/modules/...`
3. Start module process (Manager `ModuleRuntimeSupervisor`)
4. App reads client contributions through the shared extension manager screen

Target-machine samples such as Screen Stream and Machine Helper VPN install at
the extension/account level, then enable their target component on selected
machines. Those samples declare `placement.kind = "selectedMachine"` and
`defaultEnabled = false` so the helper is not activated on every machine.

**Gaps today:** real production zip artifacts/signing, update runner, and
target-cell package transport for pending selected-machine deployments.

## Dev — Teams

```powershell
# Terminal 1 — service
cd modules/teams && yarn install && yarn build && yarn start

# Terminal 2 — playground (expo already running is fine)
cd D:/Projects/glixo-playground-app/standalone
# open /teams-live
```
