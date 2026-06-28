export type TeamsConversation = {
  id: string;
  threadId: string;
  title: string;
  preview: string | null;
  unreadCount: number;
  updatedAt: number;
  kind: string;
};

export type TeamsMessage = {
  id: string;
  role: string;
  authorName: string | null;
  body: string;
  sentAt: number;
};

export type TeamsOutboxEvent = {
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: number;
};

export type TeamsServiceClientOptions = {
  baseUrl: string;
  pollIntervalMs?: number;
};

export class TeamsServiceClient {
  private readonly baseUrl: string;
  private eventSince = 0;
  private pollTimer?: ReturnType<typeof setInterval>;
  private onEvent?: (events: TeamsOutboxEvent[]) => void;

  constructor(opts: TeamsServiceClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  async health(): Promise<{ ok: boolean; auth?: string }> {
    const r = await fetch(`${this.baseUrl}/health`);
    return r.json() as Promise<{ ok: boolean; auth?: string }>;
  }

  async authStatus(): Promise<{ status: string; detail?: string }> {
    const r = await fetch(`${this.baseUrl}/v1/auth/status`);
    return r.json() as Promise<{ status: string; detail?: string }>;
  }

  async startAuth(): Promise<{ sessionId: string; userCode: string; verificationUri: string }> {
    const r = await fetch(`${this.baseUrl}/v1/auth/device-code/start`, { method: 'POST' });
    return r.json() as Promise<{ sessionId: string; userCode: string; verificationUri: string }>;
  }

  async pollAuth(sessionId: string): Promise<{ status: string }> {
    const r = await fetch(`${this.baseUrl}/v1/auth/device-code/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    return r.json() as Promise<{ status: string }>;
  }

  async listConversations(): Promise<TeamsConversation[]> {
    const r = await fetch(`${this.baseUrl}/v1/conversations`);
    const data = await r.json() as { conversations: TeamsConversation[] };
    return data.conversations;
  }

  async getMessages(conversationId: string): Promise<TeamsMessage[]> {
    const r = await fetch(`${this.baseUrl}/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
    const data = await r.json() as { messages: TeamsMessage[] };
    return data.messages;
  }

  async sendMessage(conversationId: string, text: string): Promise<TeamsMessage> {
    const r = await fetch(`${this.baseUrl}/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await r.json() as { message: TeamsMessage };
    return data.message;
  }

  async replayEvents(since?: number): Promise<TeamsOutboxEvent[]> {
    const s = since ?? this.eventSince;
    const r = await fetch(`${this.baseUrl}/v1/events/replay?since=${s}&limit=100`);
    const data = await r.json() as { events: TeamsOutboxEvent[] };
    if (data.events.length > 0) {
      this.eventSince = data.events[data.events.length - 1]!.seq;
    }
    return data.events;
  }

  startEventPolling(onEvent: (events: TeamsOutboxEvent[]) => void, intervalMs = 3000): void {
    this.onEvent = onEvent;
    this.stopEventPolling();
    this.pollTimer = setInterval(() => {
      void this.replayEvents().then((events) => {
        if (events.length > 0) this.onEvent?.(events);
      });
    }, intervalMs);
  }

  stopEventPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}
