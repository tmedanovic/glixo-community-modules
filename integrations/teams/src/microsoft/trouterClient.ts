import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  fetchWithTimeout,
  getAccessToken,
  type MicrosoftCredentials,
} from '@glixo/microsoft-native-auth';
import type { UpdateRefreshFn } from './types.js';

const HEARTBEAT_INTERVAL_MS = 25_000;
const RECONNECT_INITIAL_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

export type TrouterChatEvent = {
  channel: string;
  sessionId: string;
  body: unknown;
};

type TrouterTunneledRequest = {
  id: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type TrouterLogFn = (msg: string, extra?: Record<string, unknown>) => void;

export class TrouterClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private clientMsgId = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private stopped = false;
  private sessionId: string | null = null;
  private surl: string | null = null;
  private registrationId = randomUUID();

  constructor(
    private creds: MicrosoftCredentials,
    private region: string,
    private onRefresh: UpdateRefreshFn,
    private log: TrouterLogFn = () => {},
  ) {
    super();
  }

  updateCreds(creds: MicrosoftCredentials): void {
    this.creds = creds;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const ic3Token = await getAccessToken(this.creds, 'ic3', (rt) => this.onRefresh(this.creds, rt));
    if (!ic3Token) {
      this.log('trouter.no_token', { userId: this.creds.userId });
      this.scheduleReconnect();
      return;
    }

    const tc = encodeURIComponent(JSON.stringify({
      cv: '2026.12.01.1',
      ua: 'TeamsCDL',
      hr: '',
      v: '1415/26040401723',
    }));
    const url = `wss://go-${this.region}.trouter.teams.microsoft.com/v4/c/?tc=${tc}&timeout=40&epid=${randomUUID()}&ccid=&cor_id=${randomUUID()}&con_num=${Date.now()}_0`;

    this.log('trouter.connecting', { userId: this.creds.userId, region: this.region });
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.sendEvent('user.authenticate', [{
        headers: { 'X-Ms-Test-User': 'False', Authorization: `Bearer ${ic3Token}` },
      }]);
    });

    ws.on('message', (data) => {
      for (const line of data.toString('utf-8').split('\n')) {
        if (line) this.handleSingle(line);
      }
    });

    ws.on('error', (err) => {
      this.log('trouter.ws_error', { err: String(err) });
    });

    ws.on('close', (code, reason) => {
      this.log('trouter.closed', { code, reason: reason.toString().slice(0, 120) });
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.emit('disconnected', { code, reason: reason.toString() });
      this.ws = null;
      this.sessionId = null;
      this.scheduleReconnect();
    });
  }

  private handleSingle(frame: string): void {
    if (frame.startsWith('1::') || frame.startsWith('2::')) return;
    const m = frame.match(/^(\d):([^:]*):([^:]*):(.*)$/s);
    if (!m) return;
    const [, type, msgIdRaw, , data] = m;
    const msgId = msgIdRaw.replace(/\+$/, '').length > 0 ? Number(msgIdRaw.replace(/\+$/, '')) : null;
    if (type === '5') this.handleEvent(msgId, data);
    else if (type === '3') this.handleTunneled(msgId, data);
  }

  private handleEvent(_msgId: number | null, data: string): void {
    let parsed: { name?: string; args?: unknown[] };
    try { parsed = JSON.parse(data); } catch { return; }
    const name = parsed.name;
    const args = Array.isArray(parsed.args) ? parsed.args : [];

    if (name === 'trouter.connected') {
      const info = args[0] as { id?: string; surl?: string };
      this.sessionId = info?.id ?? null;
      this.surl = info?.surl ?? null;
      this.startHeartbeat();
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      this.log('trouter.connected', { sessionId: this.sessionId });
      this.emit('connected', info);
      void this.registerForNotifications();
    } else if (name === 'trouter.message_loss') {
      const indicators = (args[0] as { droppedIndicators?: unknown })?.droppedIndicators;
      this.sendEvent('trouter.processed_message_loss', [{ droppedIndicators: indicators }]);
      this.sendEvent('user.activity', [{ state: 'active', cv: randomUUID() + '.0.1' }]);
    }
  }

  private handleTunneled(serverMsgId: number | null, data: string): void {
    let req: TrouterTunneledRequest;
    try { req = JSON.parse(data) as TrouterTunneledRequest; } catch { return; }

    if (this.ws && serverMsgId !== null) {
      this.ws.send(`3:::${JSON.stringify({ id: req.id, status: 200, headers: {}, body: '' })}`);
    }

    const channelMatch = req.url.match(/\/v4\/f\/[^/]+\/([^?]+)/);
    const channel = channelMatch?.[1] ?? 'unknown';
    let body: unknown = req.body;
    if (typeof req.body === 'string' && req.body.length > 0) {
      try { body = JSON.parse(req.body); } catch { /* keep raw */ }
    }

    this.emit('message', { channel, sessionId: this.sessionId ?? '', body } satisfies TrouterChatEvent);
  }

  private sendEvent(name: string, args: unknown[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = ++this.clientMsgId;
    this.ws.send(`5:${id}+::${JSON.stringify({ name, args })}`);
  }

  private async registerForNotifications(): Promise<void> {
    if (!this.surl) return;
    const ic3Token = await getAccessToken(this.creds, 'ic3', (rt) => this.onRefresh(this.creds, rt));
    if (!ic3Token) return;
    try {
      const resp = await fetchWithTimeout('https://teams.microsoft.com/registrar/prod/V2/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ic3Token}` },
        body: JSON.stringify({
          clientDescription: {
            appId: 'TeamsCDLWebWorker',
            aesKey: '',
            languageId: 'en-US',
            platform: 'edge',
            templateKey: 'TeamsCDLWebWorker_2.1',
            platformUIVersion: '2026.12.01.1',
          },
          registrationId: this.registrationId,
          nodeId: '',
          transports: { TROUTER: [{ context: '', path: this.surl, ttl: 86400 }] },
        }),
      });
      this.log('trouter.registrar', { status: resp.status });
    } catch (e) {
      this.log('trouter.registrar_error', { err: String(e) });
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.sendEvent('ping', []);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => { void this.connect(); }, delay);
  }
}
