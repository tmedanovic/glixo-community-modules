# MS Teams — extraction map

**Service + plugin split** — see `genie-platform/docs/architecture/glixo-services-vs-plugins.md`.

| Artifact | Id | Role |
|----------|-----|------|
| **Service** | `glixo.messaging.teams` | Auth, module DB, sync, events, HTTP `:6120` |
| **Plugin** | `glixo.plugin.teams-split-inbox` | Split inbox UI (`/teams-live` in playground) |

## Service source (genie monorepo)

| Area | Path |
|------|------|
| Sync + realtime | `packages/genie-server/sources/modules/integrations/teams/` |
| OAuth routes | `packages/genie-server/sources/app/api/routes/teamsRoutes.ts` |
| Token refresh | `httpTeamsAdapter.ts` → `getAccessToken(creds, audience)` |
| Built-in descriptor | `builtInModules.ts` → `builtin.messaging.teams` |

## Implemented in this repo (alpha)

- `migrations/001_init.sql` — module-owned SQLite schema
- `src/auth/deviceCode.ts` — mock device-code (real flow: port from teamsRoutes)
- `src/events/outbox.ts` — `message.ingested` + `teams.conversation.updated` + replay API
- `src/store/conversations.ts` — CRUD + demo seed
- `src/client/TeamsServiceClient.ts` — HTTP client for plugins
- `GET /health`, `GET /v1/events/replay`

## Still to port from genie-server

- Trouter WebSocket (`trouterClient.ts`, `teamsRealtimeWorker.ts`)
- Multi-audience refresh (`httpTeamsAdapter.ts`)
- `genie.messages.ingest` host capability call on persist
- Call orchestration → stays coordinated with `genie.teams.recorder` in platform

## Native companion

`genie.teams.recorder` stays in **genie-platform** (machine audio), not this Node service.

## Dev

```powershell
cd D:/Projects/glixo-community-modules/modules/teams
yarn install
yarn build
yarn start
# http://127.0.0.1:6120/health
```

Playground: `/teams-live` (requires service running).
