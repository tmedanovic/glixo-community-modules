import type { TeamsDb } from '../db/openDb.js';

export type OutboxEvent = {
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: number;
};

export function appendEvent(db: TeamsDb, eventType: string, payload: Record<string, unknown>): number {
  const occurredAt = Date.now();
  const result = db.prepare(
    'insert into event_outbox (event_type, payload_json, occurred_at) values (?, ?, ?)',
  ).run(eventType, JSON.stringify(payload), occurredAt);
  return Number(result.lastInsertRowid);
}

export function replayEvents(db: TeamsDb, sinceSeq: number, limit = 100): OutboxEvent[] {
  const rows = db.prepare(
    'select seq, event_type, payload_json, occurred_at from event_outbox where seq > ? order by seq asc limit ?',
  ).all(sinceSeq, limit) as Array<{ seq: number; event_type: string; payload_json: string; occurred_at: number }>;
  return rows.map((r) => ({
    seq: r.seq,
    eventType: r.event_type,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    occurredAt: r.occurred_at,
  }));
}

/** Contract: message.ingested pointer event (after host/module persists message). */
export function emitMessageIngested(db: TeamsDb, args: {
  messageId: string;
  conversationId: string;
  userId: string;
  direction?: 'inbound' | 'outbound';
}): number {
  return appendEvent(db, 'message.ingested', {
    messageId: args.messageId,
    conversationId: args.conversationId,
    source: 'teams',
    userId: args.userId,
    occurredAt: Date.now(),
    direction: args.direction ?? 'inbound',
  });
}

export function emitConversationUpdated(db: TeamsDb, args: {
  conversationId: string;
  userId: string;
  unreadCount?: number;
  preview?: string;
}): number {
  return appendEvent(db, 'teams.conversation.updated', {
    conversationId: args.conversationId,
    userId: args.userId,
    occurredAt: Date.now(),
    unreadCount: args.unreadCount,
    preview: args.preview,
  });
}
