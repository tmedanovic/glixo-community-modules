# Glixo Teams service (`glixo.messaging.teams`)

Installable Microsoft Teams messaging service for Glixo Manager + playground.

## Dev run (no Manager)

```powershell
cd modules/teams
$env:TEAMS_AUTH_MOCK = '1'   # optional: mock auth + demo chats
yarn install
yarn build
yarn start
```

Playground: open `/teams-live` (service at `http://127.0.0.1:6120`).

## Real Microsoft auth

```powershell
cd modules/teams
# Do NOT set TEAMS_AUTH_MOCK
yarn start
```

1. POST `/v1/auth/device-code/start` → open verification URI, enter user code
2. POST `/v1/auth/device-code/poll` until `connected`
3. Service backfills chats and starts Trouter realtime (unless `TEAMS_REALTIME=0`)

## Manager install

```powershell
cd modules/teams/scripts
./package-dev-artifact.ps1
```

1. Add catalog source: `D:\Projects\glixo-community-modules\modules\teams` (or repo root with manifest path)
2. Manager → Install `glixo.messaging.teams` → accept runtime policy → Start
3. Playground `/teams-live` talks to `:6120`

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

- **`@glixo/microsoft-native-auth`** — shared device-code + token refresh (Outlook can reuse)
- **Trouter** — stays inside this service (Outlook uses OWA polling, not Trouter)
- **Plugin** — `plugins/teams-split-inbox` is UI-only; consumes this HTTP API + event replay
