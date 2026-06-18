export const MICROSOFT_NATIVE_AUTH_KIND = 'office-native';

export const MICROSOFT_NATIVE_CLIENTS = {
  teamsDesktop: '1fec8e78-bce4-4aaf-ab1b-5451cc387264',
  office: 'd3590ed6-52b3-4102-aeff-aad2292ab01c',
} as const;

export type MicrosoftNativeClient = keyof typeof MICROSOFT_NATIVE_CLIENTS;

export const MICROSOFT_LOGIN_AUTHORITY = 'https://login.microsoftonline.com';

export const MICROSOFT_BASE_SCOPES = ['openid', 'profile', 'offline_access'] as const;

/** Per-audience refresh grants (Teams + Outlook native flows). */
export const MICROSOFT_AUDIENCES = {
  chatsvc: 'https://chatsvcagg.teams.microsoft.com/.default',
  ic3: 'https://ic3.teams.office.com/.default',
  presence: 'https://presence.teams.microsoft.com/.default',
  substrate: 'https://substrate.office.com/.default',
  spaces: 'https://api.spaces.skype.com/.default',
  graph: 'https://graph.microsoft.com/.default',
  outlook: 'https://outlook.office.com/.default',
} as const;

export type MicrosoftAudience = keyof typeof MICROSOFT_AUDIENCES;

export const TEAMS_REGION_DEFAULT = 'emea';
