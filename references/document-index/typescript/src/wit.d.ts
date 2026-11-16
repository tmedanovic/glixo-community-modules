declare module 'glixo:contribution/broker@1.0.0' {
  export function workspaceSearch(handle: string, query: string, limit: number): string;
  export function workspaceRead(handle: string, path: string, maxBytes: number): string;
}
