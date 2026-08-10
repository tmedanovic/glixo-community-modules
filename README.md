# glixo-community-modules

Official source for production-ready Glixo community integrations and separately
maintained extension-author examples.

- **Marketplace:** [extend.glixo.io](https://extend.glixo.io)
- **Builder docs:** [docs.glixo.dev](https://docs.glixo.dev)
- **Publish / validate:** [glixo.dev](https://glixo.dev)

Product language is **extensions** — `service`, `extension`, and `component` are implementation roles inside `glixo.module.json`. Platform architecture: `glixo-platform/docs/architecture/GLIXO_PLATFORM_EXTENSION_SYSTEM.md` (in the main Glixo monorepo).

## Repository layout

```
bundled/                 First-party LLM providers (preinstalled; marketplace is browse-only)
catalog/
  code/                  Installable, user-facing integrations only
examples/
  code/                  Developer examples; never synced to the marketplace
  agxos/apps/            Agxos authoring examples; never synced to the marketplace
integrations/teams/      Alpha Teams messaging service (not in marketplace catalog)
packages/                Shared auth helpers for integrations
archive/                 Retired stubs — not synced to the catalog (see archive/README.md)
design/theme-references/ Optional mockup PNGs for theme exploration
scripts/                 Pack artifacts, capture marketplace screenshots
```

## Marketplace catalog

Only modules under `catalog/` are synced into the hosted bundle by
[Glixo developer portal](https://gitlab.com/tmedanovic/glixo-portals/-/tree/main/dev)
(`npm run catalog:sync`). A marketplace listing must be useful to an end user,
ship every declared runtime entry point, and pass install/activation smoke tests.
Manifest validation and a matching SHA-256 are necessary, but are not sufficient.

### Glixo Code extensions (`catalog/code/`)

| Directory | Extension id | Summary |
|-----------|--------------|---------|
| `cliproxy-provider` | `glixo.providers.cliproxy` | Connect Glixo to an existing CLIProxy instance |
| `onedrive-storage` | `glixo.storage.onedrive` | Installable OneDrive storage provider |
| `dropbox-storage` | `glixo.storage.dropbox` | Installable Dropbox storage provider |
| `gitnexus` | `glixo.integrations.gitnexus` | GitNexus MCP server + skill |

### Developer examples (`examples/`)

Examples are source material for extension authors. They are intentionally not
installable marketplace products and all carry `catalog.listed: false`.

| Directory | Example id | Purpose |
|-----------|------------|---------|
| `code/reference-llm-adapter` | `glixo.providers.reference-echo` | Out-of-process adapter wire-protocol example |
| `code/memory-inspector` | `glixo.samples.memory-inspector` | First-party host-component and agent-tool example |
| `code/tool-use-counter` | `glixo.samples.tool-use-counter` | First-party host-component state example |
| `agxos/apps/incident-notes` | `glixo.samples.agxos-incident-notes` | Declarative Agxos note template example |

### Bundled providers (`bundled/`)

Preinstalled via Glixo Code Server. Marketplace entries are **browse-only** — configure credentials under **Settings → Models**; they are not installed from catalog zips.

| Directory | Id |
|-----------|-----|
| `anthropic` | `glixo.providers.anthropic` |
| `gemini` | `glixo.providers.gemini` |
| `gemini-oauth` | `glixo.providers.gemini-oauth` |
| `openai` | `glixo.providers.openai` |
| `openai-oauth` | `glixo.providers.openai-oauth` |
| `ollama` | `glixo.providers.ollama` |
| `omniroute` | `glixo.providers.omniroute` |

CLIProxy is first-party but installable, so it lives under `catalog/code/cliproxy-provider` and ships through the regular catalog artifact flow. OneDrive and Dropbox are storage providers, not bundled LLM providers; they live under `catalog/code/*-storage` and must be installed before they appear in Settings.

Declarative provider authoring: [docs.glixo.dev/provider-extensions.html](https://docs.glixo.dev/provider-extensions.html).

## Contribute

1. **Fork** this repo. Start from `examples/`, but add a submission under
   `catalog/code/` only after it is a complete, end-user-usable integration.
2. Author `glixo.module.json` — see [manifest reference](https://extend.glixo.io/artifacts/docs/v0/manifest-reference.md).
3. **Pack artifacts** (updates zip + SHA-256):

   ```powershell
   cd glixo-community-modules
   node scripts/pack-catalog-artifacts.mjs
   ```

   Re-running the command must leave the tree unchanged. Catalog artifacts use
   canonical line endings and fixed ZIP metadata; `glixo.module.json` is
   delivered separately so its `sha256` does not become self-referential.

4. **Test locally** with the developer portal:

   ```powershell
   cd ../glixo-portals/dev
   npm run catalog:sync
   npm run catalog:pack
   ```

   Point `GLIXO_COMMUNITY_MODULES_REPO` at your clone (see `glixo-portals/dev/scripts/community-root.mjs`).

5. Open a pull request. Maintainers run catalog deploy to update [extend.glixo.io](https://extend.glixo.io).

### Agxos apps — source repository

Public marketplace listings for Agxos apps should declare where source lives (policy; API enforcement coming):

```json
"sourceRepository": {
  "url": "https://github.com/tmedanovic/glixo-community-modules",
  "directory": "examples/agxos/apps/incident-notes"
}
```

For third-party apps, use your own public GitHub/GitLab URL. See [docs.glixo.dev/publish.html](https://docs.glixo.dev/publish.html#source-repository).

### Fork and extend

To study or extend a teaching sample, copy a folder from `examples/`, change ids,
and implement the complete runtime before submitting it to `catalog/`. Guide:
[docs.glixo.dev/extend-existing-app.html](https://docs.glixo.dev/extend-existing-app.html).

## Capture marketplace screenshots

With Glixo Code running locally (UI on `:8103`, server on `:33103`, Agxos iframe on `:5180`):

```powershell
cd glixo-community-modules
node scripts/capture-catalog-screenshots.mjs
node scripts/pack-catalog-artifacts.mjs
cd ../glixo-portals/dev && npm run catalog:sync
```

Set `E2E_HEADED=1` to watch Playwright. Optional theme mockups: `design/theme-references/`.

## Catalog admission rule

An entry is removed rather than listed when its artifact omits a declared entry
point, its UI component is not registered by the host, it only returns placeholder
data, or the feature has moved into Glixo core. Examples are not a fallback product
category: they live under `examples/` and are excluded from catalog generation.

## Other code not in the catalog

| Path | Why |
|------|-----|
| `archive/` | Retired stubs with placeholder artifacts — reference only |
| `integrations/teams/` | Alpha service; not production-ready for marketplace |

## Teams integration (alpha)

```powershell
cd integrations/teams
yarn install && yarn build && yarn start
```

See [integrations/teams/README.md](integrations/teams/README.md).
