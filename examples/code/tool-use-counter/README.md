# Tool Use Counter

Tool Use Counter is the smallest Glixo Code sidebar Extension sample. It adds a
host-rendered **Tool usage** panel to the session right rail and contributes a
tool-usage AI context provider.

Use this sample when you want to build a sidebar-only or sidebar-first
Extension.

## What it contributes

- **Sidebar view - `session.sidebar`**: `contributes.sidebarViews[]` points at
  `ToolUseCounterPanel`.
- **Client component**: a `client` component declares `ui` and uses the
  host-bundled `client-bundled-in-app` placeholder entry.
- **AI context provider**: `contributes.aiContextProviders[]` exposes scoped
  tool-usage stats.

The actual React component is registered in Glixo Code at
`sources/extensions/toolUseCounter.tsx`:

```ts
registerExtensionComponent('ToolUseCounterPanel', ToolUseCounterPanel);
```

The module is imported by `sources/extensions/index.ts` so the registration side
effect runs when Glixo Code starts.

## Add your own sidebar Extension

1. Copy this folder and change the manifest `id`, `name`, component id, and
   contribution ids.
2. Keep `slot: "session.sidebar"` unless Glixo Code has added another mounted
   sidebar slot.
3. Add or update a React component in `glixo-code/sources/extensions/`.
4. Register that component with `registerExtensionComponent(...)`.
5. Import the component module from `glixo-code/sources/extensions/index.ts`.
6. Repack the catalog artifact and sync the portal catalog:

   ```powershell
   cd glixo-community-modules
   node scripts/pack-catalog-artifacts.mjs
   cd ../glixo-portals/dev
   npm run catalog:sync
   ```

7. Validate the sample manifests from Glixo Code:

   ```powershell
   cd ../glixo-code
   corepack yarn verify:extension-samples
   ```

Open a fresh Glixo Code session after installing the Extension. The panel should
appear in the right rail for the active session.
