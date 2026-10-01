declare module 'glixo:contribution/broker@1.0.0' {
  export type WResult<T> = { readonly tag: 'ok'; readonly val: T } | { readonly tag: 'err'; readonly val: string };
  export function workspaceSearch(handle: string, query: string, limit: number): WResult<string>;
}
