import { randomUUID } from 'node:crypto';
import {
  MICROSOFT_NATIVE_AUTH_KIND,
  MICROSOFT_NATIVE_CLIENTS,
  decodeIdTokenClaims,
  fetchUserRegion,
  pollDeviceCodeToken,
  requestDeviceCode,
  type MicrosoftNativeClient,
} from '@glixo/microsoft-native-auth';
import type { TeamsDb } from '../db/openDb.js';
import { saveCredentials, getAuthStatus as readAuthStatus } from '../credentials/store.js';

export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'error';

export type DeviceCodeSession = {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  status: AuthStatus;
  detail?: string;
};

type PendingFlow = {
  userId: string;
  tenant: string;
  client: MicrosoftNativeClient;
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
};

const pending = new Map<string, PendingFlow>();

export const DEFAULT_USER = 'playground-user';

export async function startDeviceCodeFlow(
  userId: string,
  opts?: { tenant?: string; client?: MicrosoftNativeClient; mock?: boolean },
): Promise<DeviceCodeSession> {
  const sessionId = randomUUID();
  const useMock = opts?.mock === true || process.env.TEAMS_AUTH_MOCK === '1';
  if (useMock) {
    pending.set(sessionId, {
      userId,
      tenant: 'common',
      client: 'teamsDesktop',
      deviceCode: 'mock',
      intervalMs: 5000,
      expiresAt: Date.now() + 15 * 60_000,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
    });
    return {
      sessionId,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresAt: Date.now() + 15 * 60_000,
      status: 'pending',
    };
  }

  const tenant = opts?.tenant ?? process.env.TEAMS_AUTH_TENANT ?? 'common';
  const client = opts?.client ?? 'teamsDesktop';
  const dc = await requestDeviceCode(tenant, client);
  pending.set(sessionId, {
    userId,
    tenant,
    client,
    deviceCode: dc.deviceCode,
    intervalMs: dc.intervalMs,
    expiresAt: dc.expiresAt,
    userCode: dc.userCode,
    verificationUri: dc.verificationUri,
    verificationUriComplete: dc.verificationUriComplete,
  });
  return {
    sessionId,
    userCode: dc.userCode,
    verificationUri: dc.verificationUri,
    verificationUriComplete: dc.verificationUriComplete,
    expiresAt: dc.expiresAt,
    status: 'pending',
  };
}

export async function pollDeviceCode(
  sessionId: string,
  db: TeamsDb,
  userId: string,
  onConnected?: () => void,
): Promise<DeviceCodeSession> {
  const flow = pending.get(sessionId);
  if (!flow) {
    return { sessionId, userCode: '', verificationUri: '', expiresAt: 0, status: 'error', detail: 'Unknown session' };
  }
  if (Date.now() > flow.expiresAt) {
    pending.delete(sessionId);
    return { sessionId, userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt, status: 'error', detail: 'Expired' };
  }

  if (process.env.TEAMS_AUTH_MOCK === '1' && flow.deviceCode === 'mock') {
    storeMockCredentials(db, userId);
    pending.delete(sessionId);
    onConnected?.();
    return { sessionId, userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt, status: 'connected' };
  }

  const result = await pollDeviceCodeToken(flow.tenant, flow.client, flow.deviceCode);
  if (result.status === 'pending') {
    return {
      sessionId,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      verificationUriComplete: flow.verificationUriComplete,
      expiresAt: flow.expiresAt,
      status: 'pending',
    };
  }
  if (result.status === 'error') {
    pending.delete(sessionId);
    return { sessionId, userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt, status: 'error', detail: result.detail };
  }

  const claims = decodeIdTokenClaims(result.idToken);
  const clientId = MICROSOFT_NATIVE_CLIENTS[flow.client];
  const accountHandle = claims?.preferred_username ?? claims?.upn ?? claims?.name ?? null;
  const payload = {
    refreshToken: result.refreshToken,
    idToken: result.idToken,
    tenantId: claims?.tid ?? flow.tenant,
    accountOid: claims?.oid ?? null,
    authKind: MICROSOFT_NATIVE_AUTH_KIND,
    clientId,
    accountHandle,
  };
  const accountId = saveCredentials(db, userId, payload, { accountHandle });
  const creds = { accountId, userId, payload };
  const region = await fetchUserRegion(creds, () => {});
  if (region) saveCredentials(db, userId, { ...payload, region }, { accountHandle });

  pending.delete(sessionId);
  onConnected?.();
  return { sessionId, userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt, status: 'connected' };
}

function storeMockCredentials(db: TeamsDb, userId: string): void {
  saveCredentials(db, userId, {
    refreshToken: 'mock-refresh',
    tenantId: 'mock-tenant',
    accountOid: 'mock-oid',
    clientId: MICROSOFT_NATIVE_CLIENTS.teamsDesktop,
    authKind: 'mock',
    accountHandle: 'mock@example.com',
  });
}

export function getAuthStatus(db: TeamsDb, userId: string): { status: AuthStatus; detail?: string } {
  return readAuthStatus(db, userId) as { status: AuthStatus; detail?: string };
}

export function disconnectAuth(db: TeamsDb, userId: string): void {
  db.prepare('delete from auth_account where user_id = ?').run(userId);
}
