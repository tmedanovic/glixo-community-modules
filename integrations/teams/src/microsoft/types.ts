import type { MicrosoftCredentials } from '@glixo/microsoft-native-auth';

export type UpdateRefreshFn = (creds: MicrosoftCredentials, refreshToken: string) => void;
