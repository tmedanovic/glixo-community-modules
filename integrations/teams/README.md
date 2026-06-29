# Glixo Teams service (`glixo.messaging.teams`)

**Alpha** — Microsoft Teams messaging integration for Glixo. Not listed on the public marketplace catalog yet (`dev-placeholder` artifact in manifest).

## Dev run (standalone)

```powershell
cd integrations/teams
$env:TEAMS_AUTH_MOCK = '1'   # optional: mock auth + demo chats
yarn install
yarn build
yarn start
```

Service listens on `http://127.0.0.1:6120` by default.

## Real Microsoft auth

```powershell
cd integrations/teams
# Do NOT set TEAMS_AUTH_MOCK
yarn start
```

1. `POST /v1/auth/device-code/start` → open verification URI, enter user code
2. `POST /v1/auth/device-code/poll` until `connected`
3. Service backfills chats and starts Trouter realtime (unless `TEAMS_REALTIME=0`)

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `TEAMS_MODULE_PORT` | `6120` | HTTP port |
| `TEAMS_MODULE_DATA` | `~/.glixo/modules/teams` | SQLite data dir |
| `TEAMS_AUTH_MOCK` | off | `1` = mock device-code + demo seed data |
| `TEAMS_REALTIME` | on | `0` = disable Trouter worker |
| `TEAMS_BACKFILL` | on | `0` = skip history import on connect |
| `TEAMS_DEMO_TICK` | off | `1` = simulate inbound every 45s |

## Architecture

- **`@glixo/microsoft-native-auth`** (`packages/microsoft-native-auth`) — shared device-code + token refresh
- **Trouter** — realtime inside this service
- **Extension UI** — archived sketch at `archive/extensions/teams-split-inbox` (not in catalog)

See `EXTRACTION.md` for monorepo source map.
