import { randomUUID } from 'node:crypto';
import type { TeamsDb } from '../db/openDb.js';

export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'error';

export type DeviceCodeSession = {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  status: AuthStatus;
  detail?: string;
};

const pending = new Map<string, DeviceCodeSession>();

/** Microsoft device-code flow — production path matches genie-server teamsRoutes. */
export async function startDeviceCodeFlow(userId: string, opts?: { mock?: boolean }): Promise<DeviceCodeSession> {
  const sessionId = randomUUID();
  if (opts?.mock !== false && process.env.TEAMS_AUTH_MOCK !== '0') {
    const session: DeviceCodeSession = {
      sessionId,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresAt: Date.now() + 15 * 60_000,
      status: 'pending',
    };
    pending.set(sessionId, session);
    return session;
  }
  // Real flow: POST to login.microsoftonline.com/.../devicecode (extract from genie-server)
  throw new Error('Native device-code flow not wired in this alpha — set TEAMS_AUTH_MOCK=1 for dev');
}

export function pollDeviceCode(sessionId: string, db: TeamsDb, userId: string): DeviceCodeSession {
  const session = pending.get(sessionId);
  if (!session) {
    return { sessionId, userCode: '', verificationUri: '', expiresAt: 0, status: 'error', detail: 'Unknown session' };
  }
  if (session.status === 'connected') return session;
  if (Date.now() > session.expiresAt) {
    session.status = 'error';
    session.detail = 'Expired';
    return session;
  }
  // Mock: auto-connect after first poll in dev
  if (process.env.TEAMS_AUTH_MOCK !== '0') {
    session.status = 'connected';
    storeMockCredentials(db, userId);
    pending.set(sessionId, session);
  }
  return session;
}

function storeMockCredentials(db: TeamsDb, userId: string): void {
  const now = Date.now();
  db.prepare(`
    insert into auth_account (id, user_id, tenant_id, account_oid, client_id, refresh_token_cipher, health_status, connected_at, updated_at)
    values (?, ?, ?, ?, ?, ?, 'ok', ?, ?)
    on conflict(id) do update set health_status='ok', connected_at=excluded.connected_at, updated_at=excluded.updated_at
  `).run('default', userId, 'mock-tenant', 'mock-oid', 'mock-client', 'mock-cipher', now, now);
}

export function getAuthStatus(db: TeamsDb, userId: string): { status: AuthStatus; detail?: string } {
  const row = db.prepare('select health_status, health_detail from auth_account where user_id = ?').get(userId) as
    | { health_status: string; health_detail: string | null }
    | undefined;
  if (!row) return { status: 'disconnected' };
  if (row.health_status === 'ok') return { status: 'connected' };
  return { status: 'error', detail: row.health_detail ?? undefined };
}
