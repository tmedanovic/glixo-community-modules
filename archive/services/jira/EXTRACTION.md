# Jira service extraction

## Source (glixo-server)

| File | Role |
|------|------|
| `integrations/jira/httpJiraAdapter.ts` | Cloud/on-prem REST (PAT/basic) |
| `integrations/jira/daemonProxyJiraAdapter.ts` | VPN/on-prem via daemon proxy |
| `integrations/jira/syncState.ts` | Sync cursors |
| `integrations/jira/issueCache.ts` | Cached issue rows |

## Target (`glixo.work.jira`)

| Implemented | Pending |
|-------------|---------|
| Health, `/v1/issues` (assigned JQL live fetch) | Background sync worker |
| Module SQLite cache | `work.item.changed` host upsert |
| Config via `GLIXO_MODULE_CONFIG_*` + `secrets.jira` | Daemon proxy transport |
| | Comment/update issue APIs |

## Config

Manager sets `siteUrl`, `email` in module-config; API token via `{GLIXO_HOME}/secrets/jira.secret` → `GLIXO_MODULE_SECRET_JIRA`.

Default port: **6130**.
