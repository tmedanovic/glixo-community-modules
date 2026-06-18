import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { openModuleDb } from './db/openDb.js';
import { handleRequest } from './api/routes.js';
import { listConversations, simulateInbound } from './store/conversations.js';

const port = Number(process.env.TEAMS_MODULE_PORT ?? process.env.PORT ?? 6120);
const dataDir = process.env.TEAMS_MODULE_DATA ?? path.join(os.homedir(), '.glixo', 'modules', 'teams');

function log(msg: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg, ...extra }));
}

const db = openModuleDb(dataDir);

const server = http.createServer((req, res) => {
  void handleRequest(req, res, { db, log });
});

server.listen(port, '127.0.0.1', () => {
  log('teams.service.started', { port, dataDir });
});

// Demo realtime: simulate inbound message every 45s when connected
if (process.env.TEAMS_DEMO_TICK !== '0') {
  setInterval(() => {
    const convs = listConversations(db, 'playground-user');
    if (convs.length === 0) return;
    const pick = convs[Math.floor(Math.random() * convs.length)]!;
    simulateInbound(db, 'playground-user', pick.id, 'Live update from Teams service', 'Sync Worker');
    log('teams.demo.inbound', { conversationId: pick.id });
  }, 45_000);
}
