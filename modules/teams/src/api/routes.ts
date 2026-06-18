import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TeamsDb } from '../db/openDb.js';
import { getAuthStatus, pollDeviceCode, startDeviceCodeFlow } from '../auth/deviceCode.js';
import { replayEvents } from '../events/outbox.js';
import {
  getMessages,
  listConversations,
  seedDemoConversations,
  sendMessage,
  simulateInbound,
} from '../store/conversations.js';

const DEFAULT_USER = 'playground-user';

export type RouteContext = {
  db: TeamsDb;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

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
        workers: { realtime: process.env.TEAMS_REALTIME === '1' ? 'running' : 'mock' },
      });
    }

    if (method === 'GET' && url.pathname === '/v1/auth/status') {
      return json(res, 200, getAuthStatus(ctx.db, DEFAULT_USER));
    }

    if (method === 'POST' && url.pathname === '/v1/auth/device-code/start') {
      const session = await startDeviceCodeFlow(DEFAULT_USER);
      seedDemoConversations(ctx.db, DEFAULT_USER);
      return json(res, 200, session);
    }

    if (method === 'POST' && url.pathname === '/v1/auth/device-code/poll') {
      const body = await readJson(req);
      const sessionId = String(body.sessionId ?? '');
      const session = pollDeviceCode(sessionId, ctx.db, DEFAULT_USER);
      if (session.status === 'connected') seedDemoConversations(ctx.db, DEFAULT_USER);
      return json(res, 200, session);
    }

    if (method === 'GET' && url.pathname === '/v1/conversations') {
      seedDemoConversations(ctx.db, DEFAULT_USER);
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
        const msg = sendMessage(ctx.db, DEFAULT_USER, convId, text);
        ctx.log('message.sent', { conversationId: convId });
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
