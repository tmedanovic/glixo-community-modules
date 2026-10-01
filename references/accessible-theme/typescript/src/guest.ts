import { stateSet } from 'glixo:contribution/broker@1.0.0';
import { handleSavePreferences, type HostEnvelope, type ScopedState } from './handler.js';

const state: ScopedState = { set(key, value) { stateSet(key, value); } };

export const guest = {
  invoke(requestJson: string): string {
    try {
      return JSON.stringify(handleSavePreferences(JSON.parse(requestJson) as HostEnvelope, state));
    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'preferences_save_failed';
      throw message.slice(0, 128) || 'preferences_save_failed';
    }
  },
};
