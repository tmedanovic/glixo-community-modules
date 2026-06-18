import { randomUUID } from 'node:crypto';
import { createOAuthTokenStore } from '@glixo/sdk';
import type { TeamsDb } from '../db/openDb.js';
import type { MicrosoftCredentialPayload, MicrosoftCredentials } from '@glixo/microsoft-native-auth';

const DEFAULT_USER = 'playground-user';
const tokenStore = createOAuthTokenStore();

function encodePayload(payload: MicrosoftCredentialPayload & { region?: string | null }): string {
  return tokenStore.encode(payload as Parameters<typeof tokenStore.encode>[0]);
}

function decodePayload(cipher: string): (MicrosoftCredentialPayload & { region?: string | null }) | null {
  return tokenStore.decode(cipher) as (MicrosoftCredentialPayload & { region?: string | null }) | null;
}

export function loadCredentials(db: TeamsDb, userId = DEFAULT_USER): MicrosoftCredentials | null {
  const row = db.prepare(`
    select id, user_id as userId, refresh_token_cipher as cipher, tenant_id as tenantId, account_oid as accountOid, client_id as clientId, health_status as healthStatus
    from auth_account where user_id = ? order by updated_at desc limit 1
  `).get(userId) as {
    id: string; userId: string; cipher: string; tenantId: string | null; accountOid: string | null; clientId: string | null; healthStatus: string;
  } | undefined;
  if (!row) return null;
  const payload = decodePayload(row.cipher);
  if (!payload?.refreshToken) return null;
  return {
    accountId: row.id,
    userId: row.userId,
    region: payload.region ?? null,
    payload: {
      ...payload,
      tenantId: payload.tenantId ?? row.tenantId,
      accountOid: payload.accountOid ?? row.accountOid,
      clientId: payload.clientId ?? row.clientId ?? undefined,
    },
  };
}

export function saveCredentials(
  db: TeamsDb,
  userId: string,
  payload: MicrosoftCredentialPayload & { region?: string | null },
  meta?: { accountHandle?: string | null },
): string {
  const existing = db.prepare('select id from auth_account where user_id = ? order by updated_at desc limit 1')
    .get(userId) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  const now = Date.now();
  const cipher = encodePayload({ ...payload, accountHandle: meta?.accountHandle ?? payload.accountHandle });
  db.prepare('delete from auth_account where user_id = ?').run(userId);
  db.prepare(`
    insert into auth_account (id, user_id, tenant_id, account_oid, client_id, refresh_token_cipher, health_status, connected_at, updated_at)
    values (?, ?, ?, ?, ?, ?, 'ok', ?, ?)
  `).run(id, userId, payload.tenantId, payload.accountOid, payload.clientId ?? null, cipher, now, now);
  return id;
}

export function updateRefreshToken(db: TeamsDb, creds: MicrosoftCredentials, refreshToken: string): void {
  const next = { ...creds.payload, refreshToken };
  db.prepare(`
    update auth_account set refresh_token_cipher = ?, health_status = 'ok', updated_at = ? where id = ?
  `).run(encodePayload(next), Date.now(), creds.accountId);
  creds.payload.refreshToken = refreshToken;
}

export function markAuthHealth(db: TeamsDb, accountId: string, status: 'ok' | 'error', detail?: string): void {
  db.prepare(`
    update auth_account set health_status = ?, health_detail = ?, updated_at = ? where id = ?
  `).run(status, detail ?? null, Date.now(), accountId);
}

export function getAuthStatus(db: TeamsDb, userId = DEFAULT_USER): { status: string; detail?: string } {
  const row = db.prepare('select health_status, health_detail from auth_account where user_id = ? order by updated_at desc limit 1')
    .get(userId) as { health_status: string; health_detail: string | null } | undefined;
  if (!row) return { status: 'disconnected' };
  if (row.health_status === 'ok') return { status: 'connected' };
  return { status: 'error', detail: row.health_detail ?? undefined };
}

export { DEFAULT_USER as TEAMS_DEFAULT_USER };
