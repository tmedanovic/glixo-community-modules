# GitHub service extraction

## Source (genie-server)

| File | Role |
|------|------|
| `integrations/github/githubClient.ts` | REST client (search PRs, list repos) |
| `integrations/github/syncWorker.ts` | 15-min background sync |
| `integrations/github/prCache.ts` | PR cache rows |
| `integrations/github/repoCache.ts` | Repo metadata |

## Target (`glixo.work.github`)

| Implemented | Pending |
|-------------|---------|
| Health, `/v1/pull-requests` (involved PR search) | Background sync worker |
| Module SQLite cache | Pin repos UI flow |
| PAT via `secrets.github` | `work.item.changed` host upsert |

Default port: **6131**.

## Plugin

`glixo.plugin.github-prs` in playground — lists PRs from service HTTP.
