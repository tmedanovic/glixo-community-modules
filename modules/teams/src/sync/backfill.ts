import type { MicrosoftCredentials } from '@glixo/microsoft-native-auth';
import type { TeamsDb } from '../db/openDb.js';
import { listGroupChats, fetchMessages } from '../microsoft/teamsApi.js';
import type { UpdateRefreshFn } from '../microsoft/types.js';
import { upsertConversation, persistApiMessage } from '../store/persistMessage.js';
import { emitConversationUpdated } from '../events/outbox.js';

export type BackfillLogFn = (msg: string, extra?: Record<string, unknown>) => void;

export async function backfillForUser(
  db: TeamsDb,
  creds: MicrosoftCredentials,
  onRefresh: UpdateRefreshFn,
  log: BackfillLogFn = () => {},
): Promise<{ chats: number; messages: number }> {
  const region = creds.region ?? 'emea';
  const chats = await listGroupChats(creds, onRefresh, region);
  if (!chats) {
    log('backfill.no_chats');
    return { chats: 0, messages: 0 };
  }

  let messageCount = 0;
  const selfOid = creds.payload.accountOid;

  for (const chat of chats) {
    const convId = upsertConversation(
      db,
      creds.userId,
      chat.id,
      chat.title ?? 'Teams chat',
      chat.isGroup ? 'chat' : 'chat',
    );
    if (chat.lastMessageTimestamp) {
      db.prepare('update conversations set updated_at = ? where id = ?')
        .run(new Date(chat.lastMessageTimestamp).getTime(), convId);
    }
    emitConversationUpdated(db, {
      conversationId: convId,
      userId: creds.userId,
      preview: chat.title ?? undefined,
    });

    const messages = await fetchMessages(creds, chat.id, onRefresh, region, 50);
    if (!messages) continue;
    for (const msg of messages) {
      const result = persistApiMessage(db, creds.userId, convId, msg, selfOid);
      if (result === 'inserted') messageCount++;
    }
  }

  log('backfill.done', { chats: chats.length, messages: messageCount });
  return { chats: chats.length, messages: messageCount };
}
