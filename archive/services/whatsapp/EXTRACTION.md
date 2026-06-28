# WhatsApp service extraction

## Source

| Location | Role |
|----------|------|
| `glixo-server/integrations/whatsapp/outgoing.ts` | Send path |
| `glixo-agent-vm/whatsapp-bridge` | Native/daemon bridge |
| glixo-server reply routes | Inbound ingest |

## Target (`glixo.messaging.whatsapp`)

**Alpha scaffold only** — WhatsApp requires a **daemon/native bridge**, not pure HTTP OAuth like Teams.

| Implemented | Pending |
|-------------|---------|
| Health + summary stub | Bridge proxy to daemon |
| Catalog manifest | Inbound `message.ingested` |
| | Outgoing send capability |

Default port: **6132**.

Until bridge lands, WhatsApp parity stays on `dev.ps1 -Profile full-node`.
