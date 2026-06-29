# MS Teams - extraction map



**Service + extension split** - see `glixo-platform/docs/architecture/glixo-extension-components.md`.



| Artifact | Id | Role |

|----------|-----|------|

| **Service** | `glixo.messaging.teams` | Auth, module DB, sync, events, HTTP `:6120` |

| **Extension** | `glixo.extension.teams-split-inbox` | Split inbox UI (`/teams-live` in playground) |



## Service source (glixo monorepo)



| Area | Path |

|------|------|

| Sync + realtime | `packages/glixo-server/sources/modules/integrations/teams/` |

| OAuth routes | `packages/glixo-server/sources/app/api/routes/teamsRoutes.ts` |

| Token refresh | `httpTeamsAdapter.ts` -> `getAccessToken(creds, audience)` |

| Built-in descriptor | `builtInModules.ts` -> `builtin.messaging.teams` |



## Implemented in this repo (alpha)



- `migrations/001_init.sql` - module-owned SQLite schema (applied on start)

- `@glixo/microsoft-native-auth` - device-code + multi-audience refresh

- `src/auth/deviceCode.ts` - real Microsoft device-code (mock via `TEAMS_AUTH_MOCK=1`)

- `src/microsoft/trouterClient.ts` + `src/workers/realtimeWorker.ts` - Trouter realtime

- `src/microsoft/teamsApi.ts` - list chats, fetch messages, send

- `src/sync/backfill.ts` - history import on connect

- `src/events/outbox.ts` - `message.ingested` + `teams.conversation.updated` + replay API

- `src/credentials/store.ts` - SQLite credential persistence (encrypt when host injects `GLIXO_MODULE_SECRET`)

- `src/client/TeamsServiceClient.ts` - HTTP client for extensions

- `scripts/package-dev-artifact.ps1` - zip + SHA256 for Manager catalog



## Still to port / gaps



- Channel threads (`@thread.tacv2`) - realtime + persistence via `channelThreads.ts` (Graph channel backfill deferred)
- Host `message.ingest` relay when `GLIXO_HOST_MESSAGE_INGEST_URL` set

- `glixo.messages.ingest` host capability call on persist (when host routing exists)

- Presence worker (`teamsPresenceWorker.ts`) - optional

- Call events / `Event/Call` -> coordinated with `glixo.teams.recorder` in glixo-platform (not this service)



## Native companion



`glixo.teams.recorder` stays in **glixo-platform** (machine audio), not this Node service.



## Dev



```powershell

cd integrations/teams

yarn install && yarn build && yarn start

# http://127.0.0.1:6120/health

```



Playground: `/teams-live` (requires service running). URL from `glixo-app.config.json` or `EXPO_PUBLIC_TEAMS_SERVICE_URL`.
