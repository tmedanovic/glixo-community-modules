export type MicrosoftCredentialPayload = {
  refreshToken: string;
  idToken?: string;
  tenantId: string | null;
  accountOid: string | null;
  authKind?: string;
  clientId?: string;
  accountHandle?: string | null;
};

export type MicrosoftCredentials = {
  accountId: string;
  userId: string;
  payload: MicrosoftCredentialPayload;
  region?: string | null;
};

export type CredentialStore = {
  load(userId: string): MicrosoftCredentials | null;
  save(userId: string, payload: MicrosoftCredentialPayload, meta?: { accountHandle?: string | null }): string;
  updatePayload(accountId: string, payload: MicrosoftCredentialPayload): void;
  markHealth(accountId: string, status: 'ok' | 'error', detail?: string): void;
};

export type DeviceCodeStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
};

export type DeviceCodeSession = DeviceCodeStart & {
  sessionId: string;
};

export type IdTokenClaims = {
  oid?: string;
  tid?: string;
  preferred_username?: string;
  upn?: string;
  name?: string;
};
