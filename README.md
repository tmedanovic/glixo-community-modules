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

These samples now have real zip artifacts and SHA-256 values, so they should
preview and install from a local folder, hosted catalog zip, or Git checkout
without stub gating:

- `samples/hello-extension`
- `samples/tool-use-counter`
- `samples/interactive-os-video-export`
- `samples/screen-stream`

Target-machine samples such as Screen Stream and Machine Helper VPN install at
the extension/account level, then enable their target component on selected
machines. Those samples declare `placement.kind = "selectedMachine"` and
`defaultEnabled = false` so the helper is not activated on every machine.
Enabling a selected-machine target now materializes a package and
`target-deployment.json` descriptor in the Glixo home; cross-machine transport
and remote process start are still pending.

**Gaps today:** production signing for third-party releases, update runner, and
remote target-cell transport/start orchestration.

## Dev — Teams

```powershell
# Terminal 1 — service
cd modules/teams && yarn install && yarn build && yarn start

# Terminal 2 — playground (expo already running is fine)
cd D:/Projects/glixo-playground-app/standalone
# open /teams-live
```
