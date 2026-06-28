import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isGoogleConfigured, readGoogleOAuthConfig } from '@glixo/google-native-auth';
import { fetchInboxUnreadCount, listInboxThreads } from './gmailApi.js';

const port = Number(process.env.GMAIL_MODULE_PORT ?? process.env.PORT ?? 6122);
const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.GMAIL_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'gmail');

function openDb(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'gmail.module.db'));
  db.exec(fs.readFileSync(path.join(moduleRoot, 'migrations/001_init.sql'), 'utf8'));
  return db;
}

const db = openDb();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const cfg = readGoogleOAuthConfig();
  const configured = isGoogleConfigured(cfg);

  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'glixo.messaging.gmail', auth: configured ? 'connected' : 'disconnected', workers: { sync: 'on-demand' } });
  }
  if (url.pathname === '/v1/auth/status') {
    return json(res, 200, { status: configured ? 'connected' : 'disconnected' });
  }
  if (url.pathname === '/v1/summary') {
    const unread = configured ? await fetchInboxUnreadCount(cfg) : null;
    const cached = (db.prepare('select coalesce(sum(unread_count),0) as c from conversations').get() as { c: number }).c;
    return json(res, 200, {
      unreadCount: unread ?? cached,
      preview: configured ? 'Gmail INBOX' : 'Set clientId, clientSecret, secrets.google refresh token',
      service: 'gmail',
    });
  }
  if (url.pathname === '/v1/conversations') {
    if (!configured) {
      return json(res, 200, { conversations: [], configured: false, hint: 'Configure Google OAuth via Manager' });
    }
    const threads = await listInboxThreads(cfg);
    if (threads) {
      for (const t of threads) {
        db.prepare(`
          insert into conversations (id, thread_id, subject, preview, unread_count, updated_at)
          values (?, ?, ?, ?, 1, ?)
          on conflict(thread_id) do update set subject = excluded.subject, preview = excluded.preview, updated_at = excluded.updated_at
        `).run(t.threadId, t.threadId, t.subject, t.snippet, t.sentAt);
      }
      return json(res, 200, {
        conversations: threads.map((t) => ({
          id: t.threadId,
          title: t.subject ?? t.fromName ?? t.threadId,
          preview: t.snippet,
          unreadCount: 1,
          updatedAt: t.sentAt,
        })),
        configured: true,
        source: 'live',
      });
    }
    const cached = db.prepare('select id, subject as title, preview, unread_count as unreadCount, updated_at as updatedAt from conversations order by updated_at desc limit 50').all();
    return json(res, 200, { conversations: cached, configured: true, source: 'cache' });
  }
  if (url.pathname === '/v1/events/replay') {
    const since = Number(url.searchParams.get('since') ?? '0');
    const rows = db.prepare('select seq, event_type, payload_json, occurred_at from event_outbox where seq > ? order by seq asc limit 100').all(since) as Array<{ seq: number; event_type: string; payload_json: string; occurred_at: number }>;
    return json(res, 200, { events: rows.map((r) => ({ seq: r.seq, eventType: r.event_type, payload: JSON.parse(r.payload_json), occurredAt: r.occurred_at })) });
  }
  return json(res, 404, { error: 'not found' });
}).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ msg: 'gmail.service.started', port, dataDir }));
});
