import { GOOGLE_TOKEN_URL } from './constants.js';
import type { GoogleOAuthConfig } from './config.js';
import { fetchWithTimeout } from './fetch.js';

let cached: { token: string; expiresAt: number } | null = null;

export async function getGoogleAccessToken(cfg: GoogleOAuthConfig): Promise<string | null> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) return null;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const resp = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

export function clearGoogleTokenCache(): void {
  cached = null;
}
