declare module 'glixo:contribution/broker@1.0.0' {
  export function stateGet(key: string): string | undefined;
  export function stateSet(key: string, value: string): void;
  export function stateList(prefix: string): readonly string[];
  export function stateDelete(key: string): boolean;
}
