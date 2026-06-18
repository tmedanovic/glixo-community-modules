import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isJiraConfigured, readJiraConfig } from './config.js';
import { searchAssignedIssues } from './jiraApi.js';

const port = Number(process.env.JIRA_MODULE_PORT ?? process.env.PORT ?? 6130);
const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.JIRA_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'jira');

function openDb(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'jira.module.db'));
  db.exec(fs.readFileSync(path.join(moduleRoot, 'migrations/001_init.sql'), 'utf8'));
  return db;
}

const db = openDb();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const cfg = readJiraConfig();
  const configured = isJiraConfigured(cfg);

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'glixo.work.jira',
      auth: configured ? 'connected' : 'disconnected',
      workers: { sync: 'pending' },
    });
  }

  if (url.pathname === '/v1/auth/status') {
    return json(res, 200, { status: configured ? 'connected' : 'disconnected', siteUrl: cfg.siteUrl ?? undefined });
  }

  if (url.pathname === '/v1/summary') {
    const count = (db.prepare('select count(*) as c from work_items').get() as { c: number }).c;
    return json(res, 200, {
      openCount: count,
      preview: configured ? 'Jira alpha — assigned issues on demand' : 'Configure site URL, email, and API token',
      service: 'jira',
    });
  }

  if (url.pathname === '/v1/issues') {
    if (!configured) {
      return json(res, 200, { issues: [], configured: false, hint: 'Set GENIE_MODULE_CONFIG_SITEURL, EMAIL, and secrets.jira' });
    }
    const live = await searchAssignedIssues(cfg);
    if (live) {
      for (const issue of live) {
        db.prepare(`
          insert into work_items (id, external_key, title, state, url, updated_at)
          values (?, ?, ?, ?, ?, ?)
          on conflict(external_key) do update set title = excluded.title, state = excluded.state, url = excluded.url, updated_at = excluded.updated_at
        `).run(issue.key, issue.key, issue.title, issue.state, issue.url, issue.updatedAt);
      }
      return json(res, 200, { issues: live, configured: true, source: 'live' });
    }
    const cached = db.prepare('select external_key as key, title, state, url, updated_at as updatedAt from work_items order by updated_at desc limit 50').all();
    return json(res, 200, { issues: cached, configured: true, source: 'cache' });
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ msg: 'jira.service.started', port, dataDir }));
});
