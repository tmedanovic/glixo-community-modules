import { fetchWithTimeout, getGoogleAccessToken, readGoogleOAuthConfig, type GoogleOAuthConfig } from '@glixo/google-native-auth';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type GmailThreadSummary = {
  id: string;
  threadId: string;
  subject: string | null;
  fromName: string | null;
  snippet: string;
  sentAt: number;
};

function parseHeader(headers: Array<{ name?: string; value?: string }>, name: string): string | null {
  const hit = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value?.trim() ?? null;
}

function parseFromName(from: string | null): string | null {
  if (!from) return null;
  const match = from.match(/^([^<]+)</);
  return (match?.[1] ?? from).trim().replace(/^"|"$/g, '');
}

export async function listInboxThreads(cfg: GoogleOAuthConfig, limit = 25): Promise<GmailThreadSummary[] | null> {
  const token = await getGoogleAccessToken(cfg);
  if (!token) return null;
  const listResp = await fetchWithTimeout(
    `${GMAIL_API}/messages?labelIds=INBOX&maxResults=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listResp.ok) return null;
  const list = await listResp.json() as { messages?: Array<{ id: string; threadId?: string }> };
  const ids = (list.messages ?? []).map((m) => m.id).filter(Boolean);
  const out: GmailThreadSummary[] = [];
  for (const id of ids) {
    const msgResp = await fetchWithTimeout(
      `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!msgResp.ok) continue;
    const msg = await msgResp.json() as {
      id: string; threadId?: string; snippet?: string; internalDate?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    };
    const headers = msg.payload?.headers ?? [];
    const subject = parseHeader(headers, 'Subject');
    const fromRaw = parseHeader(headers, 'From');
    const sentAt = msg.internalDate ? Number(msg.internalDate) : Date.now();
    out.push({
      id: msg.id,
      threadId: msg.threadId ?? msg.id,
      subject,
      fromName: parseFromName(fromRaw),
      snippet: msg.snippet ?? '',
      sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(),
    });
  }
  return out;
}

export async function fetchInboxUnreadCount(cfg: GoogleOAuthConfig): Promise<number | null> {
  const token = await getGoogleAccessToken(cfg);
  if (!token) return null;
  const resp = await fetchWithTimeout(`${GMAIL_API}/labels/INBOX`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { messagesUnread?: number };
  return typeof data.messagesUnread === 'number' ? data.messagesUnread : 0;
}
