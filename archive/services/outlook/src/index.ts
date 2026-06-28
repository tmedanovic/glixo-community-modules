import crypto from 'node:crypto';

import http from 'node:http';

import path from 'node:path';

import os from 'node:os';

import Database from 'better-sqlite3';

import { fileURLToPath } from 'node:url';

import fs from 'node:fs';

import {

  MICROSOFT_AUDIENCES,

  MICROSOFT_NATIVE_CLIENTS,

  decodeIdTokenClaims,

  pollDeviceCodeToken,

  requestDeviceCode,

} from '@glixo/microsoft-native-auth';

import { createOAuthTokenStore } from '@glixo/sdk';



const port = Number(process.env.OUTLOOK_MODULE_PORT ?? process.env.PORT ?? 6121);

const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = process.env.OUTLOOK_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'outlook');

const DEFAULT_USER = 'playground-user';



const tokenStore = createOAuthTokenStore();



type PendingFlow = {

  deviceCode: string;

  expiresAt: number;

  userCode: string;

  verificationUri: string;

  verificationUriComplete?: string;

};

const pending = new Map<string, PendingFlow>();



function openDb(): Database.Database {

  fs.mkdirSync(dataDir, { recursive: true });

  const db = new Database(path.join(dataDir, 'outlook.module.db'));

  db.exec(fs.readFileSync(path.join(moduleRoot, 'migrations/001_init.sql'), 'utf8'));

  return db;

}



const db = openDb();



function json(res: http.ServerResponse, status: number, body: unknown): void {

  res.writeHead(status, { 'Content-Type': 'application/json' });

  res.end(JSON.stringify(body));

}



function readAuthStatus(): { status: string; accountHandle?: string } {

  const row = db.prepare('select health_status, account_handle from auth_account where user_id = ?')

    .get(DEFAULT_USER) as { health_status: string; account_handle: string | null } | undefined;

  if (!row || row.health_status !== 'connected') return { status: 'disconnected' };

  return { status: 'connected', accountHandle: row.account_handle ?? undefined };

}



async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {

  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(Buffer.from(chunk));

  if (chunks.length === 0) return {};

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;

}



const server = http.createServer(async (req, res) => {

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  const method = req.method ?? 'GET';



  if (method === 'GET' && url.pathname === '/health') {

    const auth = readAuthStatus();

    return json(res, 200, { ok: true, service: 'glixo.messaging.outlook', auth: auth.status, workers: { sync: 'pending' } });

  }



  if (method === 'GET' && url.pathname === '/v1/auth/status') {

    return json(res, 200, readAuthStatus());

  }



  if (method === 'POST' && url.pathname === '/v1/auth/device-code/start') {

    const sessionId = crypto.randomUUID();

    const flow = await requestDeviceCode('common', 'office', MICROSOFT_AUDIENCES.outlook);

    pending.set(sessionId, {

      deviceCode: flow.deviceCode,

      expiresAt: flow.expiresAt,

      userCode: flow.userCode,

      verificationUri: flow.verificationUri,

      verificationUriComplete: flow.verificationUriComplete,

    });

    return json(res, 200, {

      sessionId,

      userCode: flow.userCode,

      verificationUri: flow.verificationUri,

      verificationUriComplete: flow.verificationUriComplete,

      expiresAt: flow.expiresAt,

      status: 'pending',

    });

  }



  if (method === 'POST' && url.pathname === '/v1/auth/device-code/poll') {

    const body = await readJson(req);

    const sessionId = String(body.sessionId ?? '');

    const flow = pending.get(sessionId);

    if (!flow) return json(res, 404, { status: 'error', detail: 'session not found' });

    if (Date.now() > flow.expiresAt) {

      pending.delete(sessionId);

      return json(res, 200, { status: 'error', detail: 'expired' });

    }

    const token = await pollDeviceCodeToken('common', 'office', flow.deviceCode);

    if (token.status === 'pending') {

      return json(res, 200, { status: 'pending', userCode: flow.userCode, verificationUri: flow.verificationUri });

    }

    if (token.status === 'error') return json(res, 200, { status: 'error', detail: token.detail });

    pending.delete(sessionId);

    const claims = decodeIdTokenClaims(token.idToken);

    const cipher = tokenStore.encode({ refreshToken: token.refreshToken, clientId: MICROSOFT_NATIVE_CLIENTS.office });

    db.prepare(`

      insert into auth_account (id, user_id, refresh_token_cipher, health_status, account_handle, updated_at)

      values (?, ?, ?, 'connected', ?, ?)

      on conflict(id) do update set refresh_token_cipher = excluded.refresh_token_cipher,

        health_status = 'connected', account_handle = excluded.account_handle, updated_at = excluded.updated_at

    `).run(DEFAULT_USER, DEFAULT_USER, cipher, claims?.preferred_username ?? claims?.upn ?? null, Date.now());

    return json(res, 200, { status: 'connected', accountHandle: claims?.preferred_username ?? claims?.upn });

  }



  if (method === 'GET' && url.pathname === '/v1/summary') {

    const unread = (db.prepare('select coalesce(sum(unread_count),0) as c from conversations').get() as { c: number }).c;

    return json(res, 200, { unreadCount: unread, preview: 'Outlook service alpha — OWA sync pending', service: 'outlook' });

  }



  if (method === 'GET' && url.pathname === '/v1/conversations') {
    const rows = db.prepare(`
      select id, title, preview, unread_count as unreadCount, updated_at as updatedAt, thread_id as threadId
      from conversations order by updated_at desc limit 50
    `).all();
    const auth = readAuthStatus();
    return json(res, 200, {
      conversations: rows,
      configured: auth.status === 'connected',
      hint: rows.length === 0 ? 'OWA sync worker pending — auth connected but no mail synced yet' : undefined,
    });
  }

  if (method === 'GET' && url.pathname === '/v1/events/replay') {

    const since = Number(url.searchParams.get('since') ?? '0');

    const rows = db.prepare('select seq, event_type, payload_json, occurred_at from event_outbox where seq > ? order by seq asc limit 100')

      .all(since) as Array<{ seq: number; event_type: string; payload_json: string; occurred_at: number }>;

    return json(res, 200, {

      events: rows.map((r) => ({ seq: r.seq, eventType: r.event_type, payload: JSON.parse(r.payload_json), occurredAt: r.occurred_at })),

    });

  }



  return json(res, 404, { error: 'not found' });

});



server.listen(port, '127.0.0.1', () => {

  console.log(JSON.stringify({ msg: 'outlook.service.started', port, dataDir }));

});


