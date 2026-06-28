import type { JiraConfig } from './config.js';

export type JiraIssueSummary = {
  key: string;
  title: string;
  state: string | null;
  url: string | null;
  updatedAt: number;
};

function authHeader(cfg: JiraConfig): string {
  const raw = `${cfg.email}:${cfg.apiToken}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

function apiPath(siteUrl: string): string {
  return /\.atlassian\.net(\/|$)/i.test(siteUrl) ? '/rest/api/3/search' : '/rest/api/2/search';
}

export async function searchAssignedIssues(cfg: JiraConfig, limit = 25): Promise<JiraIssueSummary[] | null> {
  if (!cfg.siteUrl || !cfg.email || !cfg.apiToken) return null;
  const base = cfg.siteUrl.replace(/\/$/, '');
  const jql = encodeURIComponent('assignee = currentUser() ORDER BY updated DESC');
  const url = `${base}${apiPath(base)}?jql=${jql}&maxResults=${limit}&fields=summary,status,updated`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { issues?: Array<Record<string, unknown>> };
  return (data.issues ?? []).map((issue) => {
    const key = String(issue.key ?? '');
    const fields = (issue.fields ?? {}) as Record<string, unknown>;
    const status = fields.status as { name?: string } | undefined;
    const updated = typeof fields.updated === 'string' ? Date.parse(fields.updated) : Date.now();
    return {
      key,
      title: String(fields.summary ?? key),
      state: status?.name ?? null,
      url: key ? `${base}/browse/${key}` : null,
      updatedAt: Number.isFinite(updated) ? updated : Date.now(),
    };
  });
}
