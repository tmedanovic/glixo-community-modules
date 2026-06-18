# Gmail service extraction

## Source (genie-server)

| File | Role |
|------|------|
| `integrations/email/gmailAdapter.ts` | OAuth refresh + Gmail REST |
| `integrations/email/gmailSyncWorker.ts` | Background sync |

## Target (`glixo.messaging.gmail`)

| Implemented | Pending |
|-------------|---------|
| Health, auth status, `/v1/summary`, `/v1/conversations` (INBOX live) | Send/draft, sync worker |
| SQLite cache | `message.ingested` host relay |
| `@glixo/google-native-auth` in **community-modules/packages** | Full parity with genie-server |

## Config

- `GENIE_MODULE_CONFIG_CLIENTID`, `GENIE_MODULE_CONFIG_CLIENTSECRET`
- `secrets.google` → `GENIE_MODULE_SECRET_GOOGLE` (refresh token)

Port **6122**.
