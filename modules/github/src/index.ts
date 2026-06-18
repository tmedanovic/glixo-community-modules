import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { readGithubToken, searchInvolvedPullRequests } from './githubApi.js';

const port = Number(process.env.GITHUB_MODULE_PORT ?? process.env.PORT ?? 6131);
const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.GITHUB_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'github');

function openDb(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'github.module.db'));
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
  const token = readGithubToken();
  const configured = Boolean(token);

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'glixo.work.github',
      auth: configured ? 'connected' : 'disconnected',
      workers: { sync: 'pending' },
    });
  }

  if (url.pathname === '/v1/auth/status') {
    return json(res, 200, { status: configured ? 'connected' : 'disconnected' });
  }

  if (url.pathname === '/v1/summary') {
    const count = (db.prepare('select count(*) as c from pull_requests').get() as { c: number }).c;
    return json(res, 200, {
      openCount: count,
      preview: configured ? 'GitHub alpha — involved PRs on demand' : 'Configure secrets.github PAT',
      service: 'github',
    });
  }

  if (url.pathname === '/v1/pull-requests' || url.pathname === '/v1/pullRequests') {
    if (!token) {
      return json(res, 200, { pullRequests: [], configured: false, hint: 'Set GENIE_MODULE_SECRET_GITHUB or GITHUB_TOKEN' });
    }
    const live = await searchInvolvedPullRequests(token);
    if (live) {
      for (const pr of live) {
        const key = `${pr.repoFullName}#${pr.number}`;
        db.prepare(`
          insert into pull_requests (id, external_key, title, state, repo_full_name, url, updated_at)
          values (?, ?, ?, ?, ?, ?, ?)
          on conflict(external_key) do update set title = excluded.title, state = excluded.state, url = excluded.url, updated_at = excluded.updated_at
        `).run(key, key, pr.title, pr.state, pr.repoFullName, pr.url, pr.updatedAt);
      }
      return json(res, 200, { pullRequests: live, configured: true, source: 'live' });
    }
    const cached = db.prepare(`
      select external_key as key, title, state, repo_full_name as repoFullName, url, updated_at as updatedAt
      from pull_requests order by updated_at desc limit 50
    `).all();
    return json(res, 200, { pullRequests: cached, configured: true, source: 'cache' });
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ msg: 'github.service.started', port, dataDir }));
});
