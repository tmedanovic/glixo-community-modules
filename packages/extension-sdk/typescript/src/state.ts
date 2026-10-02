export interface ScopedState {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  list(prefix: string): readonly string[];
  delete(key: string): boolean;
}
