# Community module packages

Shared auth helpers for **services only** — not part of `@glixo/sdk`.

| Package | Path | Consumers |
|---------|------|-----------|
| `@glixo/microsoft-native-auth` | `packages/microsoft-native-auth` | Teams, Outlook |
| `@glixo/google-native-auth` | `packages/google-native-auth` | Gmail, Calendar, Contacts |

Install via `file:../../packages/...` from each module's `package.json`.

Build order (CI): SDK → auth packages → modules.
