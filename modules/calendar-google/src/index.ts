import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isGoogleConfigured, readGoogleOAuthConfig } from '@glixo/google-native-auth';
import { countUpcomingEvents, listTodayEvents } from './calendarApi.js';

const port = Number(process.env.CALENDAR_MODULE_PORT ?? process.env.PORT ?? 6123);
const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.CALENDAR_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'calendar-google');

function openDb(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'calendar.module.db'));
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
    return json(res, 200, { ok: true, service: 'glixo.calendar.google', auth: configured ? 'connected' : 'disconnected' });
  }
  if (url.pathname === '/v1/auth/status') {
    return json(res, 200, { status: configured ? 'connected' : 'disconnected' });
  }
  if (url.pathname === '/v1/summary') {
    const upcoming = configured ? await countUpcomingEvents(cfg) : null;
    return json(res, 200, {
      unreadCount: 0,
      upcomingCount: upcoming ?? 0,
      preview: configured ? `${upcoming ?? 0} events next 7 days` : 'Configure Google OAuth',
      service: 'calendar',
    });
  }
  if (url.pathname === '/v1/events/today') {
    if (!configured) {
      return json(res, 200, { events: [], configured: false });
    }
    const events = await listTodayEvents(cfg);
    if (events) {
      for (const e of events) {
        const startsAt = Date.parse(e.start) || Date.now();
        db.prepare(`
          insert into calendar_events (id, external_id, title, starts_at, ends_at, location, updated_at)
          values (?, ?, ?, ?, ?, ?, ?)
          on conflict(external_id) do update set title = excluded.title, starts_at = excluded.starts_at, location = excluded.location, updated_at = excluded.updated_at
        `).run(e.id, e.id, e.title, startsAt, e.end ? Date.parse(e.end) : null, e.location, e.updatedAt);
      }
      return json(res, 200, {
        events: events.map((e) => ({ title: e.title, start: e.start, end: e.end, location: e.location })),
        configured: true,
        source: 'live',
      });
    }
    const cached = db.prepare('select title, starts_at as start, ends_at as end, location from calendar_events order by starts_at asc limit 50').all();
    return json(res, 200, { events: cached, configured: true, source: 'cache' });
  }
  return json(res, 404, { error: 'not found' });
}).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ msg: 'calendar.google.started', port, dataDir }));
});
