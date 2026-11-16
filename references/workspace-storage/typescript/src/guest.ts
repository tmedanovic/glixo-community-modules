import { stateDelete, stateGet, stateList, stateSet } from 'glixo:contribution/broker@1.0.0';
import { handleStorage, type HostEnvelope, type ScopedState } from './handler.js';

const state: ScopedState = {
  get(key) {
    return stateGet(key);
  },
  set(key, value) { stateSet(key, value); },
  list(prefix) { return stateList(prefix); },
  delete(key) { return stateDelete(key); },
};

/** Exported by the generic contribution world as guest.invoke. */
export const guest = {
  invoke(requestJson: string): string {
    try {
      const envelope = JSON.parse(requestJson) as HostEnvelope;
      const response = handleStorage(envelope, state);
      return JSON.stringify(response);
    } catch (error) {
      throw errorPayload(error, 'storage_invoke_failed');
    }
  },
};

function errorPayload(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  return message.slice(0, 240) || fallback;
}
