export function readGithubToken(): string | null {
  return process.env.GENIE_MODULE_SECRET_GITHUB?.trim()
    ?? process.env.GITHUB_TOKEN?.trim()
    ?? null;
}

export type PullRequestSummary = {
  number: number;
  title: string;
  state: string;
  repoFullName: string;
  url: string;
  updatedAt: number;
};

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export async function searchInvolvedPullRequests(token: string, limit = 25): Promise<PullRequestSummary[] | null> {
  const q = encodeURIComponent('is:pr is:open involves:@me sort:updated-desc');
  const url = `https://api.github.com/search/issues?q=${q}&per_page=${limit}`;
  const resp = await fetch(url, {
    headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { items?: Array<Record<string, unknown>> };
  return (data.items ?? []).map((item) => {
    const repoUrl = String(item.repository_url ?? '');
    const repoMatch = repoUrl.match(/repos\/([^/]+\/[^/]+)$/);
    const repoFullName = repoMatch?.[1] ?? 'unknown/unknown';
    const number = Number(item.number ?? 0);
    const htmlUrl = String(item.html_url ?? '');
    const updated = typeof item.updated_at === 'string' ? Date.parse(item.updated_at) : Date.now();
    return {
      number,
      title: String(item.title ?? `#${number}`),
      state: String(item.state ?? 'open'),
      repoFullName,
      url: htmlUrl,
      updatedAt: Number.isFinite(updated) ? updated : Date.now(),
    };
  });
}
