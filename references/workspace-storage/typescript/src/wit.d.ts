declare module 'glixo:contribution/broker@1.0.0' {
  export type WResult<T> = { readonly tag: 'ok'; readonly val: T } | { readonly tag: 'err'; readonly val: string };
  export type WOption<T> = { readonly tag: 'some'; readonly val: T } | { readonly tag: 'none' };
  export function stateGet(key: string): WResult<WOption<string>>;
  export function stateSet(key: string, value: string): WResult<void>;
  export function stateList(prefix: string): WResult<readonly string[]>;
  export function stateDelete(key: string): WResult<boolean>;
}
