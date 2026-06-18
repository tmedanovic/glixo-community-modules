import type { TeamsDb } from '../db/openDb.js';
import { DEFAULT_USER } from '../auth/deviceCode.js';
import { getAuthStatus } from '../credentials/store.js';
import { TeamsRealtimeWorker } from '../workers/realtimeWorker.js';

export type ServiceLogFn = (msg: string, extra?: Record<string, unknown>) => void;

export class TeamsServiceRuntime {
  readonly worker: TeamsRealtimeWorker;

  constructor(
    readonly db: TeamsDb,
    private log: ServiceLogFn,
    readonly userId = DEFAULT_USER,
  ) {
    this.worker = new TeamsRealtimeWorker(db, userId, log);
  }

  async onAuthConnected(): Promise<void> {
    if (process.env.TEAMS_REALTIME === '0') {
      this.log('realtime.disabled');
      return;
    }
    await this.worker.restart();
  }

  async onAuthDisconnected(): Promise<void> {
    this.worker.stop();
  }

  async bootstrap(): Promise<void> {
    const auth = getAuthStatus(this.db, this.userId);
    if (auth.status === 'connected' && process.env.TEAMS_REALTIME !== '0') {
      await this.worker.start();
    }
  }

  healthWorkers(): { realtime: string } {
    return { realtime: this.worker.isRunning ? 'running' : 'stopped' };
  }
}
