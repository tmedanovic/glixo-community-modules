export const ACTION_ID = 'save-preferences';
export const STORAGE_KEY = 'accessible-theme/preferences/current';

export interface HostEnvelope {
  readonly kind: 'actions';
  readonly contributionId: string;
  readonly configuration?: unknown;
  readonly input: { readonly accent?: unknown; readonly largeControls?: unknown };
  readonly context: { readonly sessionId: string };
}

export interface ScopedState { set(key: string, value: string): void; }

export function handleSavePreferences(envelope: HostEnvelope, state: ScopedState): { accepted: true } {
  if (envelope.kind !== 'actions' || envelope.contributionId !== ACTION_ID) throw new Error('contribution_mismatch');
  if (typeof envelope.context?.sessionId !== 'string' || envelope.context.sessionId.trim() === '') throw new Error('session_context_missing');
  const input = envelope.input;
  const accent = input?.accent;
  const largeControls = input?.largeControls;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 2 || typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent)
    || typeof largeControls !== 'boolean') throw new Error('preferences_invalid');
  state.set(STORAGE_KEY, JSON.stringify({ accent: accent.toLowerCase(), largeControls }));
  return { accepted: true };
}
