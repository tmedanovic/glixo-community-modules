import { fetchWithTimeout } from '@glixo/google-native-auth';

export function readBridgeUrl(): string {
  return process.env.GLIXO_DAEMON_URL?.trim()
    ?? process.env.GLIXO_MODULE_CONFIG_BRIDGEURL?.trim()
    ?? process.env.WHATSAPP_BRIDGE_URL?.trim()
    ?? 'http://127.0.0.1:13050';
}

export async function probeDaemonBridge(baseUrl: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/health`;
    const resp = await fetchWithTimeout(url, {}, 3000);
    if (resp.ok) return { ok: true };
    return { ok: false, detail: `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

export type WhatsAppMessageStub = {
  id: string;
  threadId: string;
  preview: string;
  direction: 'inbound' | 'outbound';
  sentAt: number;
};

/** Placeholder until daemon whatsapp bridge is wired. */
export function listCachedMessages(): WhatsAppMessageStub[] {
  return [];
}
