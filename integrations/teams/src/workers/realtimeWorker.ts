import type { MicrosoftCredentials } from '@glixo/microsoft-native-auth';
import type { TeamsDb } from '../db/openDb.js';
import { loadCredentials, updateRefreshToken } from '../credentials/store.js';
import { TrouterClient } from '../microsoft/trouterClient.js';
import { persistTrouterBody } from '../store/persistMessage.js';
import { backfillForUser } from '../sync/backfill.js';
import { TEAMS_REGION_DEFAULT, fetchUserRegion } from '@glixo/microsoft-native-auth';

export type WorkerLogFn = (msg: string, extra?: Record<string, unknown>) => void;

export class TeamsRealtimeWorker {
  private client: TrouterClient | null = null;
  private running = false;

  constructor(
    private db: TeamsDb,
    private userId: string,
    private log: WorkerLogFn = () => {},
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const creds = loadCredentials(this.db, this.userId);
    if (!creds) {
      this.log('realtime.no_creds');
      return;
    }
    await this.ensureRegion(creds);
    this.running = true;

    if (process.env.TEAMS_BACKFILL !== '0') {
      void backfillForUser(this.db, creds, this.onRefresh, this.log);
    }

    const region = creds.region ?? TEAMS_REGION_DEFAULT;
    this.client = new TrouterClient(creds, region, this.onRefresh, this.log);
    this.client.on('message', (event) => {
      if (event.channel !== 'messaging') return;
      const latest = loadCredentials(this.db, this.userId);
      const selfOid = latest?.payload.accountOid ?? null;
      const result = persistTrouterBody(this.db, this.userId, event.body, selfOid);
      if (result === 'inserted') {
        this.log('realtime.message', { channel: event.channel });
      }
    });
    this.client.on('connected', () => this.log('realtime.trouter_connected'));
    this.client.on('disconnected', () => this.log('realtime.trouter_disconnected'));
    await this.client.start();
    this.log('realtime.started', { userId: this.userId, region });
  }

  stop(): void {
    this.running = false;
    this.client?.stop();
    this.client = null;
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  private onRefresh = (creds: MicrosoftCredentials, refreshToken: string): void => {
    updateRefreshToken(this.db, creds, refreshToken);
    this.client?.updateCreds({ ...creds, payload: { ...creds.payload, refreshToken } });
  };

  private async ensureRegion(creds: MicrosoftCredentials): Promise<void> {
    if (creds.region) return;
    const region = await fetchUserRegion(creds, (rt) => this.onRefresh(creds, rt));
    if (region) creds.region = region;
  }
}
