const PERSISTABLE = new Set(['RichText/Html', 'Text', 'RichText/Media_Generic', 'RichText/Media_AudioMsg']);

export type ParsedTeamsMessage = {
  threadId: string;
  messageId: string;
  composeTimeIso: string;
  type: string;
  fromMri: string | null;
  fromDisplayName: string | null;
  contentRaw: string | null;
  contentText: string | null;
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRealTeamsThreadId(value: string | null | undefined): boolean {
  return /^19:/i.test(value ?? '');
}

function isNotificationWrapper(value: string | null | undefined): boolean {
  return /^(?:teams:)?48:notifications/i.test(value ?? '');
}

function chooseThreadId(resourceThreadId: string | null, linkThreadId: string | null): string | null {
  if (isRealTeamsThreadId(resourceThreadId)) return resourceThreadId;
  if (isRealTeamsThreadId(linkThreadId)) return linkThreadId;
  if (isNotificationWrapper(linkThreadId) || isNotificationWrapper(resourceThreadId)) return null;
  return resourceThreadId ?? linkThreadId;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function cleanContent(html: string): string {
  return html
    .replace(/<emoji[^>]*alt="([^"]*)"[^>]*>.*?<\/emoji>/g, '$1')
    .replace(/<at[^>]*>([^<]*)<\/at>/g, '@$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTrouterMessageBody(raw: unknown): ParsedTeamsMessage | null {
  const body = raw as Record<string, unknown>;
  const r = (body?.resource ?? body) as Record<string, unknown>;
  if (!r || typeof r !== 'object') return null;

  const link = String(body?.resourceLink ?? r?.id ?? '');
  const linkMatch = link.match(/conversations\/([^/]+)\/messages\/(\d+)/);
  const linkThreadId = linkMatch?.[1] ?? null;
  const resourceThreadId = stringValue(r.threadId) ?? stringValue(r.conversationId) ?? stringValue(r.conversationid) ?? stringValue(r.chatId);
  const threadId = chooseThreadId(resourceThreadId, linkThreadId);
  const messageId = linkMatch?.[2] ?? String(r.id ?? r.messageId ?? '');
  if (!threadId || !messageId) return null;

  const type = String(r.messagetype ?? r.type ?? '');
  const composeTimeIso = normalizeTimestamp(r.composetime ?? r.originalArrivalTime ?? body?.time);
  if (!composeTimeIso) return null;

  const fromMri = typeof r.from === 'string' ? r.from : (typeof (r.from as { id?: string })?.id === 'string' ? (r.from as { id: string }).id : null);
  const fromDisplayName = typeof r.imdisplayname === 'string' ? r.imdisplayname : null;
  const contentRaw = typeof r.content === 'string' ? r.content : null;

  return {
    threadId,
    messageId,
    composeTimeIso,
    type,
    fromMri,
    fromDisplayName,
    contentRaw,
    contentText: contentRaw ? cleanContent(contentRaw) : null,
  };
}

export function shouldPersistMessage(parsed: ParsedTeamsMessage): boolean {
  if (!PERSISTABLE.has(parsed.type)) return false;
  const text = parsed.contentText?.trim();
  return Boolean(text && text.length > 0);
}

export function isOutgoingMessage(parsed: ParsedTeamsMessage, selfOid: string | null): boolean {
  if (!selfOid || !parsed.fromMri) return false;
  return parsed.fromMri.includes(selfOid);
}
