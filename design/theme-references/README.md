# Theme references

Optional **marketing / Agxos theme exploration** art — not shipped as catalog truth.

| File | Extension id |
|------|----------------|
| `{id}.png` | Matching `glixo.module.json` id (slashes → dots) |

## Populate

1. **Real UI (preferred for catalog):** with `dev.cmd` running:
   ```powershell
   cd glixo-community-modules
   node scripts/capture-catalog-screenshots.mjs
   ```
   Writes `catalog/**/assets/screenshot.png` and updates manifests.

2. **Manual mockups:** drop PNGs here for later Agxos theme work. Copy into `catalog/**/assets/` only when you intentionally want a stylized preview.

Catalog listing uses `assets/screenshot.png` when present, otherwise `assets/screenshot.svg`.
