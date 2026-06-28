import { randomUUID } from 'node:crypto';
import type { TeamsDb } from '../db/openDb.js';
import { emitConversationUpdated, emitMessageIngested } from '../events/outbox.js';
import {
  buildMessageExternalId,
  isTeamsChannelThreadId,
  resolveChannelConversationThreadId,
} from '../microsoft/channelThreads.js';
import {
  isOutgoingMessage,
  parseTrouterMessageBody,
  shouldPersistMessage,
  type ParsedTeamsMessage,
} from '../microsoft/parseTrouter.js';
import { relayMessageIngestedToHost } from '../events/hostIngest.js';
import type { TeamsApiMessage } from '../microsoft/teamsApi.js';

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

export function upsertConversation(
  db: TeamsDb,
  userId: string,
  threadId: string,
  title: string,
  kind: 'chat' | 'channel' = 'chat',
): string {
  const existing = db.prepare('select id from conversations where user_id = ? and thread_id = ?')
    .get(userId, threadId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    insert into conversations (id, user_id, thread_id, title, preview, unread_count, updated_at, kind)
    values (?, ?, ?, ?, null, 0, ?, ?)
  `).run(id, userId, threadId, title, now, kind);
  return id;
}

export type PersistResult = 'inserted' | 'duplicate' | 'skipped';

export function persistParsedMessage(
  db: TeamsDb,
  userId: string,
  parsed: ParsedTeamsMessage,
  opts: {
    selfOid?: string | null;
    conversationId?: string;
    conversationTitle?: string;
    markUnread?: boolean;
  } = {},
): PersistResult {
  if (!shouldPersistMessage(parsed)) return 'skipped';

  const externalId = buildMessageExternalId(parsed);
  const conversationThreadId = resolveChannelConversationThreadId(parsed);
  const kind = isTeamsChannelThreadId(parsed.threadId) ? 'channel' : 'chat';
  const conversationId = opts.conversationId ?? upsertConversation(
    db,
    userId,
    conversationThreadId,
    opts.conversationTitle ?? parsed.threadId.slice(0, 40),
    kind,
  );

  const dup = db.prepare('select id from messages where conversation_id = ? and external_id = ?')
    .get(conversationId, externalId) as { id: string } | undefined;
  if (dup) return 'duplicate';

  const isSelf = isOutgoingMessage(parsed, opts.selfOid ?? null);
  const role = isSelf ? 'user' : 'contact';
  const body = parsed.contentText ?? '';
  const sentAt = new Date(parsed.composeTimeIso).getTime();
  const msgId = randomUUID();

  db.prepare(`
    insert into messages (id, conversation_id, user_id, role, author_name, body, external_id, sent_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, conversationId, userId, role, parsed.fromDisplayName, body, externalId, sentAt);

  const preview = isSelf ? body : `${parsed.fromDisplayName ?? 'Contact'}: ${body}`;
  const unreadDelta = opts.markUnread !== false && !isSelf ? 1 : 0;
  db.prepare(`
    update conversations
    set preview = ?, unread_count = unread_count + ?, updated_at = ?
    where id = ?
  `).run(preview, unreadDelta, sentAt, conversationId);

  const direction: 'inbound' | 'outbound' = isSelf ? 'outbound' : 'inbound';
  const ingestPayload = {
    messageId: msgId,
    conversationId,
    userId,
    direction,
  };
  emitMessageIngested(db, ingestPayload);
  void relayMessageIngestedToHost({ ...ingestPayload, source: 'teams' });
  emitConversationUpdated(db, {
    conversationId,
    userId,
    preview,
    unreadCount: unreadDelta,
  });
  return 'inserted';
}

export function persistApiMessage(
  db: TeamsDb,
  userId: string,
  conversationId: string,
  msg: TeamsApiMessage,
  selfOid: string | null,
): PersistResult {
  const parsed: ParsedTeamsMessage = {
    threadId: msg.conversationId,
    messageId: msg.id,
    composeTimeIso: new Date(msg.composeTime).toISOString(),
    type: msg.type ?? 'RichText/Html',
    fromMri: msg.fromMri,
    fromDisplayName: msg.fromDisplayName,
    contentRaw: msg.content,
    contentText: msg.content ? cleanContent(msg.content) : null,
  };
  return persistParsedMessage(db, userId, parsed, {
    selfOid,
    conversationId,
    markUnread: false,
  });
}

export function persistTrouterBody(
  db: TeamsDb,
  userId: string,
  body: unknown,
  selfOid: string | null,
): PersistResult {
  const parsed = parseTrouterMessageBody(body);
  if (!parsed) return 'skipped';
  return persistParsedMessage(db, userId, parsed, { selfOid, markUnread: true });
}
