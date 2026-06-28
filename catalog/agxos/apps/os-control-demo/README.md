# Agxos OS Control Demo

Reference extension for Agxos **OS-control** capabilities in a **sandboxed coded app**
(`template:"app"` + `entry` bundle).

## What it demonstrates

| Surface | Manifest / API | Sandbox broker |
|---------|----------------|----------------|
| Toasts | toolbar `windowAction` + `input.notify` | `window.agxos.notify` (`notifyAgxosApp`) |
| Tray (manifest) | `contributes.agxos.trayEntries[]` + `menu[]` | Host tray context menu → `appId#intent` |
| Tray (runtime) | — | `window.agxos.tray.setEntries` (`setAgxosTrayEntries`) |
| Window | toolbar `glixo.agxos.windowAction` | `window.agxos.window.*` (`useAgxosWindow`) |

## Required grants at install

- `capability.glixo.agxos.apps.register`
- `capability.glixo.agxos.windows.control`
- `capability.glixo.agxos.notifications.create`
- `capability.glixo.agxos.tray.contribute`

## Testing checklist

1. Install from this folder (Extensions → local folder) or via the dev catalog.
2. Accept all four OS-control capabilities in the install consent dialog.
3. Open Agxos at `http://127.0.0.1:8103/code`.
4. Use the **OS Control Demo** toolbar action — expect a toast and the app window.
5. In the app, click **Notify** / **Tray green|red** / **Hide|Focus|Close**.
6. Right-click the **⚙** tray icon → choose a menu item (manifest `menu[]`).

## Author notes

- App source: `dist/app.js` (plain ES module loaded by `SandboxedAppHost`).
- SDK equivalents are documented inline; see `@glixo/agxos-app-sdk` README.
- Entry URL is resolved by glixo-code to `GET /v1/extensions/{id}/assets/dist/app.js`.
