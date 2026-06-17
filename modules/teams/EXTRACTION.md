# MS Teams — extraction map

**Do not copy composer/session UI** — this is a **service module** only.

## Source (genie monorepo)

| Area | Path |
|------|------|
| Sync + realtime | `packages/genie-server/sources/modules/integrations/teams/` |
| Routes | `packages/genie-server/sources/app/api/routes/teamsRoutes.ts` |
| Built-in descriptor | `packages/genie-server/sources/modules/catalog/builtInModules.ts` |
| Platform catalog stub | `genie-platform/catalog/genie-messaging-teams/genie.module.json` |

## Host seams (@glixo/sdk)

- `messageCapability` for outbound send
- `events` for `message.ingested`
- `relationalDb` module-scoped schema for Teams cache tables

## Native companion

`genie.teams.recorder` stays in **genie-platform** (machine audio), not this Node module.
