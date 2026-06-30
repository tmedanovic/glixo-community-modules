# glixo-community-modules

Official **community catalog source** for Glixo extensions and Agxos apps.

- **Marketplace:** [extend.glixo.io](https://extend.glixo.io)
- **Builder docs:** [docs.glixo.dev](https://docs.glixo.dev)
- **Publish / validate:** [glixo.dev](https://glixo.dev)

Product language is **extensions** — `service`, `extension`, and `component` are implementation roles inside `glixo.module.json`. Platform architecture: `glixo-platform/docs/architecture/GLIXO_PLATFORM_EXTENSION_SYSTEM.md` (in the main Glixo monorepo).

## Repository layout

```
bundled/                 First-party LLM providers (preinstalled; marketplace is browse-only)
catalog/
  code/                  Installable Glixo Code IDE extensions and providers
  agxos/
    apps/                Agxos desktop app contributions
    extensions/          Agxos session extension contributions
integrations/teams/      Alpha Teams messaging service (not in marketplace catalog)
packages/                Shared auth helpers for integrations
archive/                 Retired stubs — not synced to the catalog (see archive/README.md)
design/theme-references/ Optional mockup PNGs for theme exploration
scripts/                 Pack artifacts, capture marketplace screenshots
```

## Marketplace catalog

These modules are synced into the hosted bundle by [glixo-dev-portal](https://gitlab.com/tmedanovic/glixo-dev-portal) (`npm run catalog:sync`). Each listed sample ships a real artifact zip and SHA-256 in `glixo.module.json`.

### Glixo Code extensions (`catalog/code/`)

| Directory | Extension id | Summary |
|-----------|--------------|---------|
| `hello-extension` | `glixo.samples.hello-extension` | Minimal settings panel + command starter |
| `tool-use-counter` | `glixo.samples.tool-use-counter` | Session sidebar tool-use stats |
| `memory-inspector` | `glixo.samples.memory-inspector` | Sidebar + skill + read-only memory tool |
| `cliproxy-provider` | `glixo.providers.cliproxy` | Installable CLIProxy LLM provider |
| `gitnexus` | `glixo.integrations.gitnexus` | GitNexus MCP server + skill |
| `machine-status-board` | `glixo.samples.machine-status-board` | Selected-machine status panel |
| `screen-stream` | `glixo.samples.screen-stream` | Multi-component screen streaming sample |

### Agxos apps & extensions (`catalog/agxos/`)

| Directory | Extension id | Summary |
|-----------|--------------|---------|
| `apps/incident-notes` | `glixo.samples.agxos-incident-notes` | Template note app |
| `apps/os-control-demo` | `glixo.samples.agxos-os-control-demo` | Coded app — notify, tray, window control |
| `apps/workspace-watch` | `glixo.samples.agxos-workspace-watch` | Coded app — workspace fs.list + git status watch |
| `apps/window-screenshot` | `glixo.samples.agxos-window-screenshot` | Capture app/screen → PNG |
| `extensions/video-export` | `glixo.samples.agxos-video-export` | Timeline video export action |

**Not listed:** `catalog/code/machine-helper-vpn` (`catalog.listed = false`) — work-in-progress target-machine sample.

### Bundled providers (`bundled/`)

Preinstalled via Glixo Code Server. Marketplace entries are **browse-only** — configure credentials under **Settings → Models**; they are not installed from catalog zips.

| Directory | Id |
|-----------|-----|
| `anthropic` | `glixo.providers.anthropic` |
| `openai` | `glixo.providers.openai` |
| `openai-oauth` | `glixo.providers.openai-oauth` |
| `ollama` | `glixo.providers.ollama` |

CLIProxy is first-party but installable, so it lives under `catalog/code/cliproxy-provider` and ships through the regular catalog artifact flow.

Declarative provider authoring: [docs.glixo.dev/provider-extensions.html](https://docs.glixo.dev/provider-extensions.html).

## Contribute

1. **Fork** this repo and add a module under `catalog/code/` or `catalog/agxos/`.
2. Author `glixo.module.json` — see [manifest reference](https://extend.glixo.io/artifacts/docs/v0/manifest-reference.md).
3. **Pack artifacts** (updates zip + SHA-256):

   ```powershell
   cd glixo-community-modules
   node scripts/pack-catalog-artifacts.mjs
   ```

4. **Test locally** with glixo-dev-portal:

   ```powershell
   cd ../glixo-dev-portal
   npm run catalog:sync
   npm run catalog:pack
   ```

   Point `GLIXO_EXTENSION_CATALOG_ROOT` at your clone (see glixo-dev-portal `portals.local.ps1`).

5. Open a merge request. Maintainers run catalog deploy to update [extend.glixo.io](https://extend.glixo.io).

### Agxos apps — source repository

Public marketplace listings for Agxos apps should declare where source lives (policy; API enforcement coming):

```json
"sourceRepository": {
  "url": "https://gitlab.com/tmedanovic/glixo-community-modules",
  "directory": "catalog/agxos/apps/incident-notes"
}
```

For third-party apps, use your own public GitHub/GitLab URL. See [docs.glixo.dev/publish.html](https://docs.glixo.dev/publish.html#source-repository).

### Fork and extend

To add features to an existing sample, fork in App Creator or copy a catalog folder, change ids, bump version, and repack. Guide: [docs.glixo.dev/extend-existing-app.html](https://docs.glixo.dev/extend-existing-app.html).

## Capture marketplace screenshots

With Glixo Code running locally (UI on `:8103`, server on `:33103`, Agxos iframe on `:5180`):

```powershell
cd glixo-community-modules
node scripts/capture-catalog-screenshots.mjs
node scripts/pack-catalog-artifacts.mjs
cd ../glixo-dev-portal && npm run catalog:sync
```

Set `E2E_HEADED=1` to watch Playwright. Optional theme mockups: `design/theme-references/`.

## What is not in the catalog

| Path | Why |
|------|-----|
| `archive/` | Retired stubs with placeholder artifacts — reference only |
| `integrations/teams/` | Alpha service; not production-ready for marketplace |
| `catalog/code/machine-helper-vpn` | Explicitly unlisted until target transport is ready |

## Teams integration (alpha)

```powershell
cd integrations/teams
yarn install && yarn build && yarn start
```

See [integrations/teams/README.md](integrations/teams/README.md).
