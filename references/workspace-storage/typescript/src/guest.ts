import { stateDelete, stateGet, stateList, stateSet, type WResult } from 'glixo:contribution/broker@1.0.0';
import { handleStorage, type HostEnvelope, type ScopedState } from './handler.js';

const state: ScopedState = {
  get(key) {
    const result = unwrap(stateGet(key));
    return result.tag === 'some' ? result.val : undefined;
  },
  set(key, value) { unwrap(stateSet(key, value)); },
  list(prefix) { return unwrap(stateList(prefix)); },
  delete(key) { return unwrap(stateDelete(key)); },
};

/** Exported by the generic contribution world as guest.invoke. */
export const guest = {
  invoke(requestJson: string): WResult<string> {
    try {
      const envelope = JSON.parse(requestJson) as HostEnvelope;
      const response = handleStorage(envelope, state);
      return { tag: 'ok', val: JSON.stringify(response) };
    } catch (error) {
      return { tag: 'err', val: error instanceof Error ? error.message : 'storage_invoke_failed' };
    }
  },
};

function unwrap<T>(result: WResult<T>): T {
  if (result.tag === 'err') throw new Error(result.val);
  return result.val;
}
