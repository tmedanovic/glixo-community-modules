import {
  MICROSOFT_AUDIENCES,
  MICROSOFT_BASE_SCOPES,
  MICROSOFT_LOGIN_AUTHORITY,
  MICROSOFT_NATIVE_CLIENTS,
  type MicrosoftAudience,
  type MicrosoftNativeClient,
} from './constants.js';
import { fetchWithTimeout } from './fetch.js';
import type { DeviceCodeStart, IdTokenClaims } from './types.js';

export function decodeIdTokenClaims(idToken: string | undefined): IdTokenClaims | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as IdTokenClaims;
  } catch {
    return null;
  }
}

export async function requestDeviceCode(
  tenant: string,
  client: MicrosoftNativeClient,
  extraScope?: string,
): Promise<DeviceCodeStart> {
  const clientId = MICROSOFT_NATIVE_CLIENTS[client];
  const scope = [...MICROSOFT_BASE_SCOPES, extraScope ?? MICROSOFT_AUDIENCES.chatsvc].join(' ');
  const url = `${MICROSOFT_LOGIN_AUTHORITY}/${tenant}/oauth2/v2.0/devicecode`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope }).toString(),
  });
  const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
  if (!resp.ok || !body || typeof body.device_code !== 'string') {
    const err = body?.error_description ?? body?.error ?? `HTTP ${resp.status}`;
    throw new Error(`device-code request failed: ${String(err)}`);
  }
  return {
    deviceCode: String(body.device_code),
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    verificationUriComplete: typeof body.verification_uri_complete === 'string' ? body.verification_uri_complete : undefined,
    expiresAt: Date.now() + Number(body.expires_in ?? 900) * 1000,
    intervalMs: Number(body.interval ?? 5) * 1000,
  };
}

export type TokenPollResult =
  | { status: 'pending' }
  | { status: 'done'; accessToken: string; refreshToken: string; idToken?: string; expiresIn: number }
  | { status: 'error'; detail: string };

export async function pollDeviceCodeToken(
  tenant: string,
  client: MicrosoftNativeClient,
  deviceCode: string,
): Promise<TokenPollResult> {
  const clientId = MICROSOFT_NATIVE_CLIENTS[client];
  const resp = await fetchWithTimeout(`${MICROSOFT_LOGIN_AUTHORITY}/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode,
    }).toString(),
  });
  const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
  if (resp.ok && body && typeof body.access_token === 'string') {
    if (typeof body.refresh_token !== 'string') {
      return { status: 'error', detail: 'Microsoft did not return refresh_token' };
    }
    return {
      status: 'done',
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      idToken: typeof body.id_token === 'string' ? body.id_token : undefined,
      expiresIn: Number(body.expires_in ?? 3600),
    };
  }
  const error = String(body?.error ?? `HTTP ${resp.status}`);
  if (error === 'authorization_pending' || error === 'slow_down') return { status: 'pending' };
  return { status: 'error', detail: `${error}: ${String(body?.error_description ?? '')}` };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function tenantPath(tenantId: string | null): string {
  return tenantId && tenantId !== 'common' ? tenantId : 'common';
}

export async function getAccessToken(
  creds: { accountId: string; payload: { refreshToken: string; tenantId: string | null; clientId?: string } },
  audience: MicrosoftAudience,
  onRefreshRotated?: (refreshToken: string) => void,
): Promise<string | null> {
  const key = `${creds.accountId}:${audience}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const clientId = creds.payload.clientId ?? MICROSOFT_NATIVE_CLIENTS.teamsDesktop;
  const tokenUrl = `${MICROSOFT_LOGIN_AUTHORITY}/${tenantPath(creds.payload.tenantId)}/oauth2/v2.0/token`;
  const resp = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: creds.payload.refreshToken,
      scope: MICROSOFT_AUDIENCES[audience],
    }).toString(),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { access_token: string; expires_in: number; refresh_token?: string };
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  if (data.refresh_token && data.refresh_token !== creds.payload.refreshToken) {
    onRefreshRotated?.(data.refresh_token);
  }
  return data.access_token;
}

export async function fetchUserRegion(
  creds: Parameters<typeof getAccessToken>[0],
  onRefreshRotated?: (refreshToken: string) => void,
): Promise<string | null> {
  const token = await getAccessToken(creds, 'spaces', onRefreshRotated);
  if (!token) return null;
  try {
    const resp = await fetchWithTimeout(
      'https://teams.microsoft.com/api/mt/part/global/beta/users/8:orgid/me',
      { headers: { Authorization: `Bearer ${token}` } },
      10_000,
    );
    if (!resp.ok) return null;
    const data = await resp.json() as { region?: string };
    return typeof data.region === 'string' ? data.region : null;
  } catch {
    return null;
  }
}
