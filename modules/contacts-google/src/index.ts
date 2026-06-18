import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isGoogleConfigured, readGoogleOAuthConfig } from '@glixo/google-native-auth';
import { listConnections } from './contactsApi.js';

const port = Number(process.env.CONTACTS_MODULE_PORT ?? process.env.PORT ?? 6133);
const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.CONTACTS_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'contacts-google');

function openDb(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'contacts.module.db'));
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
    return json(res, 200, { ok: true, service: 'glixo.contacts.google', auth: configured ? 'connected' : 'disconnected' });
  }
  if (url.pathname === '/v1/auth/status') {
    return json(res, 200, { status: configured ? 'connected' : 'disconnected' });
  }
  if (url.pathname === '/v1/summary') {
    const count = (db.prepare('select count(*) as c from contacts').get() as { c: number }).c;
    return json(res, 200, { contactCount: count, preview: configured ? 'Google People connections' : 'Configure Google OAuth', service: 'contacts' });
  }
  if (url.pathname === '/v1/contacts') {
    if (!configured) {
      return json(res, 200, { contacts: [], configured: false });
    }
    const live = await listConnections(cfg);
    if (live) {
      for (const c of live) {
        db.prepare(`
          insert into contacts (id, external_id, display_name, email, phone, updated_at)
          values (?, ?, ?, ?, ?, ?)
          on conflict(external_id) do update set display_name = excluded.display_name, email = excluded.email, phone = excluded.phone, updated_at = excluded.updated_at
        `).run(c.id, c.id, c.displayName, c.email, c.phone, c.updatedAt);
      }
      return json(res, 200, { contacts: live, configured: true, source: 'live' });
    }
    const cached = db.prepare('select external_id as id, display_name as displayName, email, phone from contacts order by display_name asc limit 200').all();
    return json(res, 200, { contacts: cached, configured: true, source: 'cache' });
  }
  return json(res, 404, { error: 'not found' });
}).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ msg: 'contacts.google.started', port, dataDir }));
});
