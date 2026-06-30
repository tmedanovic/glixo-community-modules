# Agxos Workspace Watch

Reference extension for Agxos **workspace filesystem** and **OS-control** capabilities in a
**sandboxed coded app** (`template:"app"` + `entry` bundle).

## What it demonstrates

| Surface | Manifest / API | Sandbox broker |
|---------|----------------|----------------|
| File tree | `filesystem.workspace.read` grant | `window.agxos.request('fs.list', …)` |
| Git overlay | same grant | `window.agxos.request('fs.gitStatus', …)` |
| Preferences | — | `window.agxos.storage.get/set` (`refreshSeconds`, `watchPath`) |
| Polling | configurable interval (default 5s) | `setInterval` + manual refresh |
| Toasts | toolbar `windowAction` + `input.notify` | `window.agxos.notify` |
| Tray | — | `window.agxos.tray.setEntries` |
| Window title | — | `window.agxos.window.setTitle` |
| File search (optional) | requires `command.run` at runtime | `window.agxos.request('terminal.run', { command: 'rg --files …' })` |
| Replay demo | `demos[]` + `demo/demo.replay.json` | `code_os_use_app` theater turns |

## Required grants at install

- `capability.glixo.agxos.apps.register`
- `capability.glixo.agxos.windows.control`
- `capability.glixo.agxos.notifications.create`
- `capability.glixo.agxos.tray.contribute`
- `filesystem.workspace.read` (canonical taxonomy id; maps to broker `fs.list` / `fs.gitStatus`)

Optional at runtime (not in manifest `requires`): `command.run` for the **Search** button (`rg --files`).

## Testing checklist

1. Install from this folder (Extensions → local folder) or via the dev catalog.
2. Accept all five capabilities in the install consent dialog.
3. Open Agxos at `http://127.0.0.1:8103/code`.
4. Use the **Workspace Watch** toolbar action — expect a toast and the app window.
5. Confirm the file tree loads and git summary shows branch / change counts.
6. Change **Refresh (s)** and click **Refresh now** — tray icon and window title should update.
7. Click **Search** with a filter — expect `rg --files` results or a graceful error if `command.run` is not granted.
8. Open `demo/demo.replay.json` encoded URL in the Agxos replay player (`#r=…`) or run the `intro` demo from marketplace metadata when synced.

## Author notes

- App source: `dist/app.js` (plain JS loaded by `SandboxedAppHost`).
- Entry URL is resolved by glixo-code to `GET /v1/extensions/{id}/assets/dist/app.js`.
- Replay `encoded` field uses `1.<base64url(JSON)>` per `glixo-code/sources/agxos/osReplay.ts`.
