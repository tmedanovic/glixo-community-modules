import {
  TEAMS_REGION_DEFAULT,
  fetchWithTimeout,
  getAccessToken,
  type MicrosoftCredentials,
} from '@glixo/microsoft-native-auth';
import type { UpdateRefreshFn } from './types.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type TeamsChatSummary = {
  id: string;
  title: string | null;
  isGroup: boolean;
  lastMessageTimestamp: string | null;
};

export type TeamsApiMessage = {
  id: string;
  conversationId: string;
  composeTime: string;
  type: string | null;
  fromMri: string | null;
  fromDisplayName: string | null;
  content: string | null;
};

function cleanTitle(value: unknown): string | null {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || /^missing\s+teams\s+chat\s+title$/i.test(title)) return null;
  return title;
}

export async function listGroupChats(
  creds: MicrosoftCredentials,
  onRefresh: UpdateRefreshFn,
  region = creds.region ?? TEAMS_REGION_DEFAULT,
): Promise<TeamsChatSummary[] | null> {
  const token = await getAccessToken(creds, 'chatsvc', (rt) => onRefresh(creds, rt));
  if (!token) return null;
  const url = `https://teams.cloud.microsoft/api/csa/${region}/api/v1/teams/users/me/groupchats?pageSize=50`;
  const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!resp.ok) return null;
  const data = await resp.json() as { chats?: unknown[]; value?: unknown[] };
  const chats = (data.chats ?? data.value ?? data) as Record<string, unknown>[];
  if (!Array.isArray(chats)) return [];
  return chats.map((c) => ({
    id: String(c.id ?? c.threadId ?? c.chatId ?? ''),
    title: cleanTitle(c.title) ?? cleanTitle(c.topic),
    isGroup: Array.isArray(c.members) && (c.members as unknown[]).length > 2,
    lastMessageTimestamp: typeof (c.lastMessage as { composetime?: string })?.composetime === 'string'
      ? (c.lastMessage as { composetime: string }).composetime
      : null,
  })).filter((c) => c.id);
}

export async function fetchMessages(
  creds: MicrosoftCredentials,
  conversationId: string,
  onRefresh: UpdateRefreshFn,
  region = creds.region ?? TEAMS_REGION_DEFAULT,
  pageSize = 50,
): Promise<TeamsApiMessage[] | null> {
  const token = await getAccessToken(creds, 'ic3', (rt) => onRefresh(creds, rt));
  if (!token) return null;
  const encoded = encodeURIComponent(conversationId);
  const url = `https://teams.cloud.microsoft/api/chatsvc/${region}/v1/users/ME/conversations/${encoded}/messages?view=msnp24Equivalent%7CsupportsMessageProperties&pageSize=${pageSize}&startTime=1`;
  const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!resp.ok) return null;
  const data = await resp.json() as { messages?: unknown[]; value?: unknown[] };
  const messages = (data.messages ?? data.value ?? []) as Record<string, unknown>[];
  return messages.map((m) => ({
    id: String(m.id ?? m.messageId ?? ''),
    conversationId,
    composeTime: String(m.composetime ?? m.originalArrivalTime ?? ''),
    type: typeof m.messagetype === 'string' ? m.messagetype : null,
    fromMri: typeof m.from === 'string' ? m.from : null,
    fromDisplayName: typeof m.imdisplayname === 'string' ? m.imdisplayname : null,
    content: typeof m.content === 'string' ? m.content : null,
  })).filter((m) => m.id);
}

export async function sendTeamsMessage(
  creds: MicrosoftCredentials,
  conversationId: string,
  body: string,
  onRefresh: UpdateRefreshFn,
  region = creds.region ?? TEAMS_REGION_DEFAULT,
): Promise<{ id: string } | null> {
  const token = await getAccessToken(creds, 'ic3', (rt) => onRefresh(creds, rt));
  if (!token) return null;
  const encoded = encodeURIComponent(conversationId);
  const url = `https://teams.cloud.microsoft/api/chatsvc/${region}/v1/users/ME/conversations/${encoded}/messages`;
  const clientmessageid = String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      content: `<p>${escapeHtml(body)}</p>`,
      messagetype: 'RichText/Html',
      contenttype: 'text',
      clientmessageid,
      imdisplayname: creds.payload.accountHandle ?? 'Glixo',
      properties: { importance: '', subject: null },
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { id?: string | number };
  return { id: String(data.id ?? clientmessageid) };
}
