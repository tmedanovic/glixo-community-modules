export type JiraConfig = {
  siteUrl: string | null;
  email: string | null;
  apiToken: string | null;
};

export function readJiraConfig(): JiraConfig {
  return {
    siteUrl: process.env.GLIXO_MODULE_CONFIG_SITEURL?.trim()
      ?? process.env.JIRA_SITE_URL?.trim()
      ?? null,
    email: process.env.GLIXO_MODULE_CONFIG_EMAIL?.trim()
      ?? process.env.JIRA_EMAIL?.trim()
      ?? null,
    apiToken: process.env.GLIXO_MODULE_SECRET_JIRA?.trim()
      ?? process.env.JIRA_API_TOKEN?.trim()
      ?? null,
  };
}

export function isJiraConfigured(cfg: JiraConfig): boolean {
  return Boolean(cfg.siteUrl && cfg.email && cfg.apiToken);
}
