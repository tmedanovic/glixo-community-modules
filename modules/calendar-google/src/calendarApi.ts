import { fetchWithTimeout, getGoogleAccessToken, type GoogleOAuthConfig } from '@glixo/google-native-auth';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export type CalendarEventSummary = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  updatedAt: number;
};

export async function listTodayEvents(cfg: GoogleOAuthConfig): Promise<CalendarEventSummary[] | null> {
  const token = await getGoogleAccessToken(cfg);
  if (!token) return null;
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const resp = await fetchWithTimeout(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { items?: Array<Record<string, unknown>> };
  return (data.items ?? []).map((item) => {
    const startObj = item.start as { dateTime?: string; date?: string } | undefined;
    const endObj = item.end as { dateTime?: string; date?: string } | undefined;
    const start = startObj?.dateTime ?? startObj?.date ?? '';
    const end = endObj?.dateTime ?? endObj?.date ?? null;
    const updated = typeof item.updated === 'string' ? Date.parse(item.updated) : Date.now();
    return {
      id: String(item.id ?? ''),
      title: String(item.summary ?? '(no title)'),
      start,
      end,
      location: typeof item.location === 'string' ? item.location : null,
      updatedAt: Number.isFinite(updated) ? updated : Date.now(),
    };
  }).filter((e) => e.id);
}

export async function countUpcomingEvents(cfg: GoogleOAuthConfig, days = 7): Promise<number | null> {
  const token = await getGoogleAccessToken(cfg);
  if (!token) return null;
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: 'true',
    maxResults: '250',
  });
  const resp = await fetchWithTimeout(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { items?: unknown[] };
  return (data.items ?? []).length;
}
