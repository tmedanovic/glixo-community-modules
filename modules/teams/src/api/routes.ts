import type { IncomingMessage, ServerResponse } from 'node:http';

import type { TeamsDb } from '../db/openDb.js';

import { DEFAULT_USER, disconnectAuth, getAuthStatus, pollDeviceCode, startDeviceCodeFlow } from '../auth/deviceCode.js';

import { loadCredentials, updateRefreshToken } from '../credentials/store.js';

import { replayEvents } from '../events/outbox.js';

import { sendTeamsMessage } from '../microsoft/teamsApi.js';

import {

  getMessages,

  listConversations,

  seedDemoConversations,

  sendMessage as sendLocalMessage,

  simulateInbound,

} from '../store/conversations.js';

import { persistParsedMessage } from '../store/persistMessage.js';

import type { TeamsServiceRuntime } from '../service/runtime.js';



export type RouteContext = {

  db: TeamsDb;

  runtime: TeamsServiceRuntime;

  log: (msg: string, extra?: Record<string, unknown>) => void;

};



const useMockData = (): boolean => process.env.TEAMS_AUTH_MOCK === '1';



export async function handleRequest(

  req: IncomingMessage,

  res: ServerResponse,

  ctx: RouteContext,

): Promise<void> {

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  const method = req.method ?? 'GET';



  try {

    if (method === 'GET' && url.pathname === '/health') {

      const auth = getAuthStatus(ctx.db, DEFAULT_USER);

      return json(res, 200, {

        ok: true,

        service: 'glixo.messaging.teams',

        auth: auth.status,

        workers: ctx.runtime.healthWorkers(),

      });

    }



    if (method === 'GET' && url.pathname === '/v1/auth/status') {

      return json(res, 200, getAuthStatus(ctx.db, DEFAULT_USER));

    }



    if (method === 'POST' && url.pathname === '/v1/auth/device-code/start') {

      const session = await startDeviceCodeFlow(DEFAULT_USER);

      if (useMockData()) seedDemoConversations(ctx.db, DEFAULT_USER);

      return json(res, 200, session);

    }



    if (method === 'POST' && url.pathname === '/v1/auth/device-code/poll') {

      const body = await readJson(req);

      const sessionId = String(body.sessionId ?? '');

      const session = await pollDeviceCode(sessionId, ctx.db, DEFAULT_USER, () => {

        void ctx.runtime.onAuthConnected();

      });

      if (session.status === 'connected' && useMockData()) {

        seedDemoConversations(ctx.db, DEFAULT_USER);

      }

      return json(res, 200, session);

    }



    if (method === 'POST' && url.pathname === '/v1/auth/disconnect') {

      disconnectAuth(ctx.db, DEFAULT_USER);

      await ctx.runtime.onAuthDisconnected();

      return json(res, 200, { ok: true });

    }



    if (method === 'GET' && url.pathname === '/v1/summary') {
      const row = ctx.db.prepare('select coalesce(sum(unread_count),0) as unread from conversations where user_id = ?')
        .get(DEFAULT_USER) as { unread: number };
      const latest = ctx.db.prepare('select preview from conversations where user_id = ? order by updated_at desc limit 1')
        .get(DEFAULT_USER) as { preview: string | null } | undefined;
      return json(res, 200, { unreadCount: row?.unread ?? 0, preview: latest?.preview ?? null, service: 'teams' });
    }

    if (method === 'GET' && url.pathname === '/v1/conversations') {

      if (useMockData() && listConversations(ctx.db, DEFAULT_USER).length === 0) {

        seedDemoConversations(ctx.db, DEFAULT_USER);

      }

      return json(res, 200, { conversations: listConversations(ctx.db, DEFAULT_USER) });

    }



    const msgMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/messages$/);

    if (msgMatch) {

      const convId = decodeURIComponent(msgMatch[1]!);

      if (method === 'GET') {

        return json(res, 200, { messages: getMessages(ctx.db, convId) });

      }

      if (method === 'POST') {

        const body = await readJson(req);

        const text = String(body.text ?? '').trim();

        if (!text) return json(res, 400, { error: 'text required' });

        const msg = await sendOutbound(ctx, convId, text);

        ctx.log('message.sent', { conversationId: convId, real: !useMockData() });

        return json(res, 200, { message: msg });

      }

    }



    if (method === 'POST' && url.pathname === '/v1/dev/simulate-inbound') {

      const body = await readJson(req);

      simulateInbound(

        ctx.db,

        DEFAULT_USER,

        String(body.conversationId),

        String(body.text),

        String(body.authorName ?? 'Contact'),

      );

      return json(res, 200, { ok: true });

    }



    if (method === 'GET' && url.pathname === '/v1/events/replay') {

      const since = Number(url.searchParams.get('since') ?? '0');

      const limit = Number(url.searchParams.get('limit') ?? '100');

      return json(res, 200, { events: replayEvents(ctx.db, since, limit) });

    }



    json(res, 404, { error: 'not found' });

  } catch (err) {

    ctx.log('request.error', { error: String(err) });

    json(res, 500, { error: String(err) });

  }

}



async function sendOutbound(ctx: RouteContext, conversationId: string, text: string) {

  if (useMockData()) {

    return sendLocalMessage(ctx.db, DEFAULT_USER, conversationId, text);

  }



  const creds = loadCredentials(ctx.db, DEFAULT_USER);

  if (!creds) throw new Error('Not authenticated');



  const conv = ctx.db.prepare('select thread_id as threadId from conversations where id = ?')

    .get(conversationId) as { threadId: string } | undefined;

  if (!conv?.threadId) throw new Error('Conversation not found');



  const onRefresh = (c: typeof creds, rt: string) => updateRefreshToken(ctx.db, c, rt);

  const sent = await sendTeamsMessage(creds, conv.threadId, text, onRefresh);

  if (!sent) throw new Error('Teams send failed');



  const parsed = {

    threadId: conv.threadId,

    messageId: sent.id,

    composeTimeIso: new Date().toISOString(),

    type: 'RichText/Html',

    fromMri: creds.payload.accountOid ? `8:orgid:${creds.payload.accountOid}` : null,

    fromDisplayName: creds.payload.accountHandle ?? null,

    contentRaw: `<p>${text}</p>`,

    contentText: text,

  };

  persistParsedMessage(ctx.db, DEFAULT_USER, parsed, {

    selfOid: creds.payload.accountOid,

    conversationId,

    markUnread: false,

  });



  return {

    id: sent.id,

    role: 'user',

    authorName: creds.payload.accountHandle ?? null,

    body: text,

    sentAt: Date.now(),

  };

}



function json(res: ServerResponse, status: number, body: unknown): void {

  res.writeHead(status, { 'Content-Type': 'application/json' });

  res.end(JSON.stringify(body));

}



function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {

  return new Promise((resolve, reject) => {

    const chunks: Buffer[] = [];

    req.on('data', (c) => chunks.push(c));

    req.on('end', () => {

      try {

        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>);

      } catch (e) {

        reject(e);

      }

    });

    req.on('error', reject);

  });

}


