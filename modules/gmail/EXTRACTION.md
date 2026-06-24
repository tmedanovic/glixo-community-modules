# Gmail service extraction

## Source (glixo-server)

| File | Role |
|------|------|
| `integrations/email/gmailAdapter.ts` | OAuth refresh + Gmail REST |
| `integrations/email/gmailSyncWorker.ts` | Background sync |

## Target (`glixo.messaging.gmail`)

| Implemented | Pending |
|-------------|---------|
| Health, auth status, `/v1/summary`, `/v1/conversations` (INBOX live) | Send/draft, sync worker |
| SQLite cache | `message.ingested` host relay |
| `@glixo/google-native-auth` in **community-modules/packages** | Full parity with glixo-server |

## Config

- `GLIXO_MODULE_CONFIG_CLIENTID`, `GLIXO_MODULE_CONFIG_CLIENTSECRET`
- `secrets.google` → `GLIXO_MODULE_SECRET_GOOGLE` (refresh token)

Port **6122**.
