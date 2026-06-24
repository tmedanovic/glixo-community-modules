export type GoogleOAuthConfig = {
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
};

export function readGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: process.env.GLIXO_MODULE_CONFIG_CLIENTID?.trim()
      ?? process.env.GOOGLE_CLIENT_ID?.trim()
      ?? null,
    clientSecret: process.env.GLIXO_MODULE_CONFIG_CLIENTSECRET?.trim()
      ?? process.env.GOOGLE_CLIENT_SECRET?.trim()
      ?? null,
    refreshToken: process.env.GLIXO_MODULE_SECRET_GOOGLE?.trim()
      ?? process.env.GLIXO_MODULE_SECRET_GMAIL?.trim()
      ?? process.env.GOOGLE_REFRESH_TOKEN?.trim()
      ?? null,
  };
}

export function isGoogleConfigured(cfg: GoogleOAuthConfig): boolean {
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.refreshToken);
}
