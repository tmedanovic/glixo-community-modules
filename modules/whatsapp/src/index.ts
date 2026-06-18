import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { listCachedMessages, probeDaemonBridge, readBridgeUrl } from './bridge.js';

const port = Number(process.env.WHATSAPP_MODULE_PORT ?? process.env.PORT ?? 6132);
const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.WHATSAPP_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'whatsapp');

function openDb(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'whatsapp.module.db'));
  db.exec(`
    create table if not exists conversations (
      id text primary key, thread_id text not null unique, title text, preview text,
      unread_count integer not null default 0, updated_at integer not null
    );
    create table if not exists messages (
      id text primary key, conversation_id text not null, body text not null,
      direction text not null, sent_at integer not null
    );
  `);
  return db;
}

const db = openDb();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const method = req.method ?? 'GET';
  const bridgeUrl = readBridgeUrl();
  const bridge = await probeDaemonBridge(bridgeUrl);

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'glixo.messaging.whatsapp',
      auth: bridge.ok ? 'bridge-connected' : 'disconnected',
      bridge: { url: bridgeUrl, ...bridge },
    });
  }
  if (url.pathname === '/v1/bridge/status') {
    return json(res, 200, { url: bridgeUrl, ...bridge });
  }
  if (url.pathname === '/v1/summary') {
    const unread = (db.prepare('select coalesce(sum(unread_count),0) as c from conversations').get() as { c: number }).c;
    return json(res, 200, {
      unreadCount: unread,
      preview: bridge.ok ? 'Daemon bridge reachable — ingest pending' : 'Start genie-cli daemon / bridge',
      service: 'whatsapp',
    });
  }
  if (url.pathname === '/v1/conversations') {
    const rows = db.prepare('select id, title, preview, unread_count as unreadCount, updated_at as updatedAt from conversations order by updated_at desc').all();
    return json(res, 200, { conversations: rows, bridgeConnected: bridge.ok });
  }
  if (url.pathname === '/v1/messages' && method === 'GET') {
    return json(res, 200, { messages: listCachedMessages(), bridgeConnected: bridge.ok });
  }
  if (url.pathname === '/v1/messages/send' && method === 'POST') {
    const body = await readJson(req);
    const text = String(body.text ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    if (!text || !phone) return json(res, 400, { error: 'phone and text required' });
    if (!bridge.ok) return json(res, 503, { error: 'daemon bridge unavailable', bridgeUrl });
    return json(res, 501, {
      error: 'not_implemented',
      hint: 'Forward to daemon whatsapp bridge when extraction completes',
      phone,
      text,
    });
  }
  return json(res, 404, { error: 'not found' });
}).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ msg: 'whatsapp.service.started', port, dataDir, bridgeUrl: readBridgeUrl() }));
});
