import { fetchWithTimeout, getGoogleAccessToken, type GoogleOAuthConfig } from '@glixo/google-native-auth';

const PEOPLE_API = 'https://people.googleapis.com/v1';

export type ContactSummary = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  updatedAt: number;
};

export async function listConnections(cfg: GoogleOAuthConfig, limit = 100): Promise<ContactSummary[] | null> {
  const token = await getGoogleAccessToken(cfg);
  if (!token) return null;
  const params = new URLSearchParams({
    personFields: 'names,emailAddresses,phoneNumbers',
    pageSize: String(Math.min(limit, 100)),
  });
  const resp = await fetchWithTimeout(`${PEOPLE_API}/people/me/connections?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { connections?: Array<Record<string, unknown>> };
  return (data.connections ?? []).map((person) => {
    const resourceName = String(person.resourceName ?? '');
    const names = person.names as Array<{ displayName?: string }> | undefined;
    const emails = person.emailAddresses as Array<{ value?: string }> | undefined;
    const phones = person.phoneNumbers as Array<{ value?: string }> | undefined;
    return {
      id: resourceName.replace(/^people\//, '') || resourceName,
      displayName: names?.[0]?.displayName ?? 'Contact',
      email: emails?.[0]?.value ?? null,
      phone: phones?.[0]?.value ?? null,
      updatedAt: Date.now(),
    };
  }).filter((c) => c.id);
}
