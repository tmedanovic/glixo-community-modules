import { randomUUID } from 'node:crypto';
import type { TeamsDb } from '../db/openDb.js';
import { emitConversationUpdated, emitMessageIngested } from '../events/outbox.js';

export type ConversationRow = {
  id: string;
  threadId: string;
  title: string;
  preview: string | null;
  unreadCount: number;
  updatedAt: number;
  kind: string;
};

export type MessageRow = {
  id: string;
  role: string;
  authorName: string | null;
  body: string;
  sentAt: number;
};

export function listConversations(db: TeamsDb, userId: string): ConversationRow[] {
  return db.prepare(`
    select id, thread_id as threadId, title, preview, unread_count as unreadCount, updated_at as updatedAt, kind
    from conversations where user_id = ? order by updated_at desc
  `).all(userId) as ConversationRow[];
}

export function getMessages(db: TeamsDb, conversationId: string): MessageRow[] {
  return db.prepare(`
    select id, role, author_name as authorName, body, sent_at as sentAt
    from messages where conversation_id = ? order by sent_at asc
  `).all(conversationId) as MessageRow[];
}

export function sendMessage(db: TeamsDb, userId: string, conversationId: string, text: string): MessageRow {
  const id = randomUUID();
  const sentAt = Date.now();
  const externalId = `local-${sentAt}`;
  db.prepare(`
    insert into messages (id, conversation_id, user_id, role, body, external_id, sent_at)
    values (?, ?, ?, 'user', ?, ?, ?)
  `).run(id, conversationId, userId, text, externalId, sentAt);
  db.prepare(`
    update conversations set preview = ?, unread_count = 0, updated_at = ? where id = ?
  `).run(text, sentAt, conversationId);
  emitMessageIngested(db, { messageId: id, conversationId, userId, direction: 'outbound' });
  emitConversationUpdated(db, { conversationId, userId, preview: text, unreadCount: 0 });
  return { id, role: 'user', authorName: null, body: text, sentAt };
}

export function seedDemoConversations(db: TeamsDb, userId: string): void {
  if (listConversations(db, userId).length > 0) return;
  const now = Date.now();
  const convs = [
    { title: 'Engineering Standup', kind: 'channel', preview: 'Alice: module scaffold is up' },
    { title: 'Carol Nguyen', kind: 'chat', preview: 'Can you test event replay?' },
  ];
  for (const c of convs) {
    const id = randomUUID();
    const threadId = `teams:19:${randomUUID()}@thread.v2`;
    db.prepare(`
      insert into conversations (id, user_id, thread_id, title, preview, unread_count, updated_at, kind)
      values (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, userId, threadId, c.title, c.preview, now - 60_000, c.kind);
    const msgId = randomUUID();
    db.prepare(`
      insert into messages (id, conversation_id, user_id, role, author_name, body, external_id, sent_at)
      values (?, ?, ?, 'contact', 'Alice', ?, ?, ?)
    `).run(msgId, id, userId, c.preview, `ext-${msgId}`, now - 120_000);
    emitMessageIngested(db, { messageId: msgId, conversationId: id, userId, direction: 'inbound' });
    emitConversationUpdated(db, { conversationId: id, userId, preview: c.preview, unreadCount: 1 });
  }
}

/** Simulates inbound message for live-update demos. */
export function simulateInbound(db: TeamsDb, userId: string, conversationId: string, text: string, authorName: string): void {
  const id = randomUUID();
  const sentAt = Date.now();
  db.prepare(`
    insert into messages (id, conversation_id, user_id, role, author_name, body, external_id, sent_at)
    values (?, ?, ?, 'contact', ?, ?, ?, ?)
  `).run(id, conversationId, userId, authorName, text, `sim-${id}`, sentAt);
  db.prepare(`
    update conversations set preview = ?, unread_count = unread_count + 1, updated_at = ? where id = ?
  `).run(`${authorName}: ${text}`, sentAt, conversationId);
  emitMessageIngested(db, { messageId: id, conversationId, userId, direction: 'inbound' });
  emitConversationUpdated(db, { conversationId, userId, preview: text, unreadCount: 1 });
}
