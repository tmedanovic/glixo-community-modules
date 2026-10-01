export const REFERENCE_ID = 'workspace-storage';
export const CONTRIBUTION_ID = 'storage';
export const TEST_PREFIX = 'workspace-storage/test/';
const keyPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const maxValueBytes = 4096;

export interface StorageInput {
  readonly operation: 'get' | 'set' | 'list' | 'delete';
  readonly key?: string;
  readonly prefix?: string;
  readonly value?: string;
}

export interface HostEnvelope {
  readonly kind: 'tool';
  readonly contributionId: string;
  readonly configuration?: unknown;
  readonly input: StorageInput;
}

export interface ScopedState {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  list(prefix: string): readonly string[];
  delete(key: string): boolean;
}

export type StorageResponse =
  | { readonly operation: 'get'; readonly key: string; readonly value: string | null }
  | { readonly operation: 'set'; readonly key: string; readonly stored: true }
  | { readonly operation: 'list'; readonly prefix: string; readonly keys: readonly string[] }
  | { readonly operation: 'delete'; readonly key: string; readonly deleted: boolean };

/** Run one bounded operation inside the installed package's explicit test prefix. */
export function handleStorage(envelope: HostEnvelope, state: ScopedState): StorageResponse {
  if (envelope.kind !== 'tool' || envelope.contributionId !== CONTRIBUTION_ID) {
    throw new Error('contribution_mismatch');
  }
  const input = envelope.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input_object_required');

  switch (input.operation) {
    case 'get': {
      const key = storageKey(input.key);
      return { operation: 'get', key: input.key!, value: state.get(key) ?? null };
    }
    case 'set': {
      const key = storageKey(input.key);
      if (typeof input.value !== 'string') throw new Error('value_string_required');
      if (new TextEncoder().encode(input.value).byteLength > maxValueBytes) throw new Error('value_too_large');
      state.set(key, input.value);
      return { operation: 'set', key: input.key!, stored: true };
    }
    case 'list': {
      const prefix = input.prefix ?? '';
      if (prefix && !keyPattern.test(prefix)) throw new Error('key_prefix_invalid');
      const fullPrefix = prefix ? storageKey(prefix) : TEST_PREFIX;
      const keys = state.list(fullPrefix)
        .filter((key) => key.startsWith(TEST_PREFIX))
        .map((key) => key.slice(TEST_PREFIX.length))
        .filter((key) => keyPattern.test(key) && key.startsWith(prefix))
        .sort((left, right) => left.localeCompare(right, 'en'))
        .slice(0, 100);
      return { operation: 'list', prefix, keys };
    }
    case 'delete': {
      const key = storageKey(input.key);
      return { operation: 'delete', key: input.key!, deleted: state.delete(key) };
    }
    default:
      throw new Error('storage_operation_invalid');
  }
}

function storageKey(value: unknown): string {
  if (typeof value !== 'string' || !keyPattern.test(value)) throw new Error('storage_key_invalid');
  return `${TEST_PREFIX}${value}`;
}
